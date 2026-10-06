import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type Json = Record<string, unknown>;
const interval = (startDate: string) => ({
  v: 1,
  type: "interval",
  every: 30,
  unit: "day",
  anchor: "completion",
  startDate,
});

describe("dashboard API", () => {
  useTestDB();
  async function member() {
    const user = await createTestUser({ displayName: "Anna" });
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }
  const task = (call: ReturnType<typeof createCaller>, json: Json) =>
    call("POST", "/api/v1/tasks", {
      json: { title: "T", trigger: interval(today(1)), ...json },
    });

  it("has a stable shape on an empty household", async () => {
    const { call } = await member();
    const r = await call("GET", "/api/v1/dashboard");
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      today: today(),
      counts: { overdue: 0, today: 0, thisWeek: 0, preparations: 0 },
      upcoming: {
        overdue: [],
        today: [],
        thisWeek: [],
        later: [],
        signalBased: [],
      },
      preparations: [],
      recentCompletions: [],
      openDefects: [],
      expiringWarranties: [],
      orderNow: [],
    });
  });

  it("shows overdue and upcoming tasks, preparations and recent completions", async () => {
    const { call, user } = await member();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Küche" } })
    ).body as { id: string };
    const asset = (
      await call("POST", "/api/v1/assets", {
        json: { name: "Dampfabzug", roomId: room.id },
      })
    ).body as { id: string };
    await task(call, {
      title: "Überfällig",
      trigger: interval(today(-4)),
      assetId: asset.id,
      assignMode: "fixed",
      assigneeUserId: user.id,
    });
    const upcoming = (
      await task(call, { title: "Bald", trigger: interval(today(3)) })
    ).body as { id: string };
    await task(call, { title: "Fern", trigger: interval(today(45)) });
    await call("POST", `/api/v1/tasks/${upcoming.id}/preparations`, {
      json: { title: "Vorbereiten", leadDays: 5 },
    });
    const done = (
      await task(call, { title: "Erledigt", trigger: interval(today(-1)) })
    ).body as { id: string };
    await call("POST", `/api/v1/tasks/${done.id}/complete`, {
      json: { source: "qr" },
    });

    const r = await call("GET", "/api/v1/dashboard");
    const body = r.body as {
      counts: Json;
      upcoming: { overdue: Json[]; thisWeek: Json[]; later: Json[] };
      preparations: Json[];
      recentCompletions: Json[];
    };
    expect(body.counts).toMatchObject({ overdue: 1, preparations: 1 });
    expect(body.upcoming.overdue).toMatchObject([
      {
        title: "Überfällig",
        assetName: "Dampfabzug",
        roomName: "Küche",
        assigneeName: "Anna",
        status: "overdue",
        date: today(-4),
      },
    ]);
    expect(
      body.upcoming.thisWeek.length + body.upcoming.later.length,
    ).toBeGreaterThanOrEqual(2);
    expect(body.preparations).toMatchObject([
      { taskTitle: "Bald", title: "Vorbereiten", state: "now" },
    ]);
    expect(body.recentCompletions).toMatchObject([
      { taskTitle: "Erledigt", source: "qr", userName: "Anna" },
    ]);
  });

  it("is readable with a read-only token", async () => {
    const user = await createTestUser();
    const call = createCaller({
      bearer: createTestToken(user, { scopes: ["read"], kind: "ha" }).token,
    });
    expect((await call("GET", "/api/v1/dashboard")).res.status).toBe(200);
  });
});

describe("stats API", () => {
  useTestDB();
  it("counts completions per person and category", async () => {
    const anna = await createTestUser();
    const call = createCaller({ session: loginTestUser(anna).token });
    const t = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Putzen",
          category: "cleaning",
          trigger: interval(today(-1)),
        },
      })
    ).body as { id: string };
    await call("POST", `/api/v1/tasks/${t.id}/complete`, { json: {} });
    await call("POST", `/api/v1/tasks/${t.id}/complete`, { json: {} });
    await call("POST", `/api/v1/tasks/${t.id}/skip`, { json: {} });
    const r = await call("GET", "/api/v1/stats");
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      to: today(),
      total: { done: 2, skipped: 1 },
      byUser: { [anna.id]: { done: 2, skipped: 1 } },
      byCategory: { cleaning: { done: 2, skipped: 1 } },
    });
  });

  it("takes a range and validates it", async () => {
    const anna = await createTestUser();
    const call = createCaller({ session: loginTestUser(anna).token });
    const ok = await call(
      "GET",
      `/api/v1/stats?from=${today(-10)}&to=${today(-5)}`,
    );
    expect(ok.body).toMatchObject({
      from: today(-10),
      to: today(-5),
      total: { done: 0 },
    });
    for (const q of [
      "?from=2026-13-01",
      `?from=${today(1)}&to=${today(-1)}`,
      "?from=2000-01-01",
    ]) {
      const r = await call("GET", `/api/v1/stats${q}`);
      expect([r.res.status, errorCode(r)], q).toEqual([400, "invalid_request"]);
    }
  });
});
