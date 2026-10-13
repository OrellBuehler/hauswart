import { describe, expect, it, vi } from "vitest";
import { getDB } from "$lib/server/db";
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
      budgetAlerts: { exceeded: 0, warning: 0, top: [] },
      pendingReceiptCount: 0,
    });
  });

  describe("the balances", () => {
    it("are the caller's place across all books", async () => {
      const { call, user } = await member();
      const r = await call("GET", "/api/v1/dashboard");
      expect(r.body).toMatchObject({
        balances: {
          currency: "CHF",
          myBalanceMinor: 0,
          hasActivity: false,
          suggestedPayments: [],
          suggestedPaymentCount: 0,
        },
      });
      expect(user.id).toBeTruthy();
    });

    it("are null when they cannot be worked out, and the rest of the dashboard is still there", async () => {
      const { call } = await member();
      await call("POST", "/api/v1/costs", {
        json: { title: "Einkauf", amountMinor: 10000, category: "groceries" },
      });
      // Payments are what the balances read and the rest of the dashboard does not.
      getDB().$client.exec("drop table settlements");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const r = await call("GET", "/api/v1/dashboard");
        expect(r.res.status).toBe(200);
        expect(r.body).toMatchObject({
          balances: null,
          today: today(),
          counts: { overdue: 0, today: 0, thisWeek: 0, preparations: 0 },
          costsYearToDate: { totalMinor: 10000 },
          pendingFinanceSuggestions: 0,
        });

        // Logged by error name and code, with nothing the error says (it names a table here).
        const lines = error.mock.calls.map((c) => String(c[0]));
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!)).toEqual({
          event: "dashboard.balances_failed",
          name: "SQLiteError",
          code: "SQLITE_ERROR",
        });
        expect(lines[0]).not.toContain("settlements");
      } finally {
        error.mockRestore();
      }
    });
  });

  describe("the budget alerts", () => {
    type Alerts = {
      exceeded: number;
      warning: number;
      top: {
        budgetId: string;
        bookId: string | null;
        bookName: string | null;
        category: string | null;
        period: string;
        amountMinor: number;
        spentMinor: number;
        currency: string;
        percentUsed: number;
        state: string;
      }[];
    };
    const alerts = async (call: ReturnType<typeof createCaller>) =>
      (
        (await call("GET", "/api/v1/dashboard")).body as {
          budgetAlerts: Alerts | null;
        }
      ).budgetAlerts;

    async function budgets() {
      const { call, user } = await member();
      const budget = async (
        category: string,
        period: "month" | "year",
        extra: Record<string, unknown> = {},
      ) =>
        (
          (
            await call("POST", "/api/v1/cost-budgets", {
              json: { category, period, amountMinor: 10000, ...extra },
            })
          ).body as { id: string }
        ).id;
      const spend = (category: string, amountMinor: number, date = today()) =>
        call("POST", "/api/v1/costs", {
          json: {
            title: `Ausgabe ${category}`,
            amountMinor,
            category,
            date,
            splitMode: "none",
          },
        });
      return { call, user, budget, spend };
    }

    it("are empty while no budget is close to its amount", async () => {
      const { call, budget, spend } = await budgets();
      expect(await alerts(call)).toEqual({ exceeded: 0, warning: 0, top: [] });
      await budget("groceries", "month");
      await spend("groceries", 7999);
      expect(await alerts(call)).toEqual({ exceeded: 0, warning: 0, top: [] });
    });

    it("count the budgets that are over or close to their amount, and list the three most urgent", async () => {
      const { call, budget, spend } = await budgets();
      const groceries = await budget("groceries", "month");
      const dining = await budget("dining", "month");
      const leisure = await budget("leisure", "month");
      await budget("travel", "month");
      const health = await budget("health", "year");
      await budget("gifts", "month", { active: false });
      await budget("transport", "month");
      await spend("groceries", 12000);
      await spend("dining", 9000);
      await spend("leisure", 8000);
      await spend("travel", 5000);
      await spend("health", 15000);
      await spend("gifts", 20000);
      await spend("transport", 20000, today(-40));

      const result = await alerts(call);
      expect(result).toMatchObject({ exceeded: 2, warning: 2 });
      expect(
        result?.top.map((a) => [a.budgetId, a.state, a.percentUsed]),
      ).toEqual([
        [health, "exceeded", 150],
        [groceries, "exceeded", 120],
        [dining, "warning", 90],
      ]);
      expect(result?.top[1]).toEqual({
        budgetId: groceries,
        bookId: null,
        bookName: null,
        category: "groceries",
        period: "month",
        amountMinor: 10000,
        spentMinor: 12000,
        currency: "CHF",
        percentUsed: 120,
        state: "exceeded",
      });
      expect(JSON.stringify(result)).not.toContain(leisure);
    });

    it("name the book of a budget that is for one", async () => {
      const { call, budget, spend } = await budgets();
      const books = (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items;
      const haushalt = books.find((b) => b.name === "Haushalt")!;
      await budget("groceries", "month", { bookId: haushalt.id });
      await call("POST", "/api/v1/costs", {
        json: {
          title: "Wochenmarkt",
          amountMinor: 11000,
          category: "groceries",
          bookId: haushalt.id,
          splitMode: "none",
        },
      });
      await spend("groceries", 99999);
      const result = await alerts(call);
      expect(result?.top).toHaveLength(1);
      expect(result?.top[0]).toMatchObject({
        bookId: haushalt.id,
        bookName: "Haushalt",
        spentMinor: 11000,
        state: "exceeded",
      });
    });

    it("agree with the status the budgets page shows, and are the same for every member", async () => {
      const { call, budget, spend } = await budgets();
      await budget("groceries", "month");
      await budget("dining", "year");
      await budget("leisure", "month");
      await spend("groceries", 10000);
      await spend("dining", 8500);
      await spend("leisure", 100);
      const status = (
        (await call("GET", "/api/v1/costs/budgets/status")).body as {
          items: { state: string }[];
        }
      ).items;
      const result = await alerts(call);
      expect(result?.exceeded).toBe(
        status.filter((i) => i.state === "exceeded").length,
      );
      expect(result?.warning).toBe(
        status.filter((i) => i.state === "warning").length,
      );
      const ben = createCaller({
        session: loginTestUser(await createTestUser({ displayName: "Ben" }))
          .token,
      });
      expect(await alerts(ben)).toEqual(result);
    });

    it("are null when they cannot be worked out, and the rest of the dashboard is still there", async () => {
      const { call } = await budgets();
      await call("POST", "/api/v1/costs", {
        json: { title: "Einkauf", amountMinor: 10000, category: "groceries" },
      });
      getDB().$client.exec("drop table cost_budgets");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const r = await call("GET", "/api/v1/dashboard");
        expect(r.res.status).toBe(200);
        expect(r.body).toMatchObject({
          budgetAlerts: null,
          today: today(),
          costsYearToDate: { totalMinor: 10000 },
          balances: { currency: "CHF" },
        });
        const lines = error.mock.calls.map((c) => String(c[0]));
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!)).toEqual({
          event: "dashboard.budget_alerts_failed",
          name: "SQLiteError",
          code: "SQLITE_ERROR",
        });
        expect(lines[0]).not.toContain("cost_budgets");
      } finally {
        error.mockRestore();
      }
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

  it("names the vehicle whose odometer a task counts on, null for every other task", async () => {
    const { call } = await member();
    const car = (
      await call("POST", "/api/v1/assets", {
        json: { name: "Familienauto", kind: "vehicle" },
      })
    ).body as { id: string };
    await task(call, {
      title: "Service",
      assetId: car.id,
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: `odometer:${car.id}`,
        threshold: 15_000,
      },
    });
    await task(call, {
      title: "Zähler",
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_meter",
        threshold: 10,
      },
    });
    await task(call, { title: "Bald", trigger: interval(today(3)) });
    const body = (await call("GET", "/api/v1/dashboard")).body as {
      upcoming: { thisWeek: Json[]; later: Json[]; signalBased: Json[] };
    };
    const byTitle = Object.fromEntries(
      [
        ...body.upcoming.signalBased,
        ...body.upcoming.thisWeek,
        ...body.upcoming.later,
      ].map((t) => [t.title, t.odometerAssetId]),
    );
    expect(byTitle).toEqual({ Service: car.id, Zähler: null, Bald: null });
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
