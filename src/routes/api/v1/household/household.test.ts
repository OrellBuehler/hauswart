import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

describe("household API", () => {
  useTestDB();
  async function as(role: "admin" | "member") {
    const user = await createTestUser({ role });
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }

  it("returns the household with defaults and its time zone", async () => {
    const { call } = await as("member");
    const r = await call("GET", "/api/v1/household");
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      name: "Haushalt",
      timezone: process.env.HAUSWART_TZ ?? "Europe/Zurich",
      currency: "CHF",
      handoverDate: null,
      settings: { dueSoonDays: 7, digestTime: "08:00" },
    });
  });

  it("lets an administrator change it", async () => {
    const { call } = await as("admin");
    const r = await call("PATCH", "/api/v1/household", {
      json: {
        name: "Musterwohnung",
        handoverDate: "2026-04-03",
        settings: { dueSoonDays: 10 },
      },
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      name: "Musterwohnung",
      handoverDate: "2026-04-03",
      settings: { dueSoonDays: 10, digestTime: "08:00" },
    });
    expect(
      (
        (
          await call("PATCH", "/api/v1/household", {
            json: { handoverDate: null },
          })
        ).body as { handoverDate: null }
      ).handoverDate,
    ).toBeNull();
    expect((await call("GET", "/api/v1/household")).body).toMatchObject({
      name: "Musterwohnung",
      settings: { dueSoonDays: 10 },
    });
  });

  it("re-evaluates tasks when the lead window changes", async () => {
    const { call } = await as("admin");
    const task = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "In 10 Tagen",
          trigger: {
            v: 1,
            type: "interval",
            every: 30,
            unit: "day",
            anchor: "completion",
            startDate: today(10),
          },
        },
      })
    ).body as { id: string };
    const status = async () =>
      (
        (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
          state: { status: string };
        }
      ).state.status;
    expect(await status()).toBe("ok");
    await call("PATCH", "/api/v1/household", {
      json: { settings: { dueSoonDays: 14 } },
    });
    expect(await status()).toBe("open");
  });

  it("keeps changes to administrators", async () => {
    const { call } = await as("member");
    const r = await call("PATCH", "/api/v1/household", { json: { name: "x" } });
    expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
    const member = await createTestUser();
    const token = createTestToken(member, {
      scopes: ["read", "write"],
      kind: "mcp",
    }).token;
    expect(
      (
        await createCaller({ bearer: token })("PATCH", "/api/v1/household", {
          json: { name: "x" },
        })
      ).res.status,
    ).toBe(403);
  });

  it("validates input and does not take the time zone", async () => {
    const { call } = await as("admin");
    for (const json of [
      {},
      { name: "" },
      { currency: "chf" },
      { handoverDate: "April" },
      { settings: { dueSoonDays: -1 } },
      { settings: { digestTime: "8am" } },
      { settings: { unknown: 1 } },
      { timezone: "Europe/Berlin" },
    ]) {
      const r = await call("PATCH", "/api/v1/household", { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
  });
});
