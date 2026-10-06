import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";

type W = {
  assetName: string;
  status: string;
  daysLeft: number;
  effectiveUntil: string;
  roomName: string | null;
};

describe("warranties API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (name: string, json: object = {}) =>
      call("POST", "/api/v1/assets", { json: { name, ...json } });
    return { call, asset };
  }

  it("lists assets with warranty dates by end date with the status computed", async () => {
    const { call, asset } = await setup();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Küche" } })
    ).body as { id: string };
    await asset("ohne");
    await asset("abgelaufen", { warrantyUntil: today(-1) });
    await asset("endet heute", { warrantyUntil: today(), roomId: room.id });
    await asset("bald", { warrantyUntil: today(90) });
    await asset("gültig", { warrantyUntil: today(91) });
    await asset("verlängert", {
      warrantyUntil: today(-10),
      warrantyExtendedUntil: today(400),
    });
    const { items } = (await call("GET", "/api/v1/warranties")).body as {
      items: W[];
    };
    expect(items.map((w) => [w.assetName, w.status, w.daysLeft])).toEqual([
      ["abgelaufen", "expired", -1],
      ["endet heute", "expiring", 0],
      ["bald", "expiring", 90],
      ["gültig", "valid", 91],
      ["verlängert", "valid", 400],
    ]);
    expect(items[1]).toMatchObject({
      roomName: "Küche",
      effectiveUntil: today(),
    });
  });

  it("filters by status, pages and validates", async () => {
    const { call, asset } = await setup();
    await asset("a", { warrantyUntil: today(-5) });
    await asset("b", { warrantyUntil: today(5) });
    await asset("c", { warrantyUntil: today(500) });
    const names = async (qs: string) =>
      (
        (await call("GET", `/api/v1/warranties${qs}`)).body as { items: W[] }
      ).items.map((w) => w.assetName);
    expect(await names("?status=expired")).toEqual(["a"]);
    expect(await names("?status=expiring")).toEqual(["b"]);
    expect(await names("?status=valid")).toEqual(["c"]);
    const page = (await call("GET", "/api/v1/warranties?limit=2")).body as {
      items: W[];
      nextCursor: string;
    };
    const next = (
      await call("GET", `/api/v1/warranties?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: W[]; nextCursor: null };
    expect([page.items.length, next.items.length, next.nextCursor]).toEqual([
      2,
      1,
      null,
    ]);
    expect(errorCode(await call("GET", "/api/v1/warranties?status=soon"))).toBe(
      "invalid_request",
    );
  });

  it("fills the dashboard with expiring and recently expired warranties", async () => {
    const { call, asset } = await setup();
    await asset("lang vorbei", { warrantyUntil: today(-31) });
    await asset("kürzlich", { warrantyUntil: today(-30) });
    await asset("bald", { warrantyUntil: today(10) });
    await asset("später", { warrantyUntil: today(120) });
    const d = (await call("GET", "/api/v1/dashboard")).body as {
      expiringWarranties: {
        id: string;
        title: string;
        date: string;
        status: string;
        daysLeft: number;
        assetId: string;
      }[];
    };
    expect(
      d.expiringWarranties.map((w) => [w.title, w.status, w.daysLeft, w.date]),
    ).toEqual([
      ["kürzlich", "expired", -30, today(-30)],
      ["bald", "expiring", 10, today(10)],
    ]);
    expect(d.expiringWarranties[0].id).toBe(d.expiringWarranties[0].assetId);
  });
});
