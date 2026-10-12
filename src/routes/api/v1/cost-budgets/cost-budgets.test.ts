import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

interface Budget {
  id: string;
  bookId: string | null;
  bookName: string | null;
  category: string | null;
  period: string;
  amountMinor: number;
  currency: string;
  active: boolean;
}
interface Status {
  year: number;
  month: number;
  currency: string;
  warningPercent: number;
  items: {
    budget: Budget;
    periodFrom: string;
    periodTo: string;
    spentMinor: number;
    entryCount: number;
    remainingMinor: number;
    percentUsed: number;
    state: string;
  }[];
}

describe("cost budgets API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const budget = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/cost-budgets", {
          json: {
            category: "groceries",
            period: "month",
            amountMinor: 50000,
            ...json,
          },
        })
      ).body as Budget;
    const cost = (json: object = {}) =>
      call("POST", "/api/v1/costs", {
        json: {
          title: "Einkauf",
          amountMinor: 1000,
          category: "groceries",
          date: "2026-03-10",
          splitMode: "none",
          ...json,
        },
      });
    const books = async () =>
      (
        (await call("GET", "/api/v1/cost-books")).body as {
          items: { id: string; name: string }[];
        }
      ).items;
    return { anna, call, budget, cost, books };
  }

  it("makes, reads, changes and deletes a budget", async () => {
    const { call, books } = await setup();
    const haushalt = (await books()).find((b) => b.name === "Haushalt")!;
    const created = await call("POST", "/api/v1/cost-budgets", {
      json: {
        bookId: haushalt.id,
        category: "groceries",
        period: "month",
        amountMinor: 80000,
      },
    });
    expect(created.res.status).toBe(201);
    const budget = created.body as Budget;
    expect(budget).toMatchObject({
      bookId: haushalt.id,
      bookName: "Haushalt",
      category: "groceries",
      period: "month",
      amountMinor: 80000,
      currency: "CHF",
      active: true,
    });
    expect(
      ((await call("GET", `/api/v1/cost-budgets/${budget.id}`)).body as Budget)
        .id,
    ).toBe(budget.id);
    expect(
      ((await call("GET", "/api/v1/cost-budgets")).body as { items: Budget[] })
        .items,
    ).toHaveLength(1);

    const patched = await call("PATCH", `/api/v1/cost-budgets/${budget.id}`, {
      json: {
        amountMinor: 90000,
        active: false,
        period: "year",
        category: null,
      },
    });
    expect(patched.body).toMatchObject({
      amountMinor: 90000,
      active: false,
      period: "year",
      category: null,
      bookId: haushalt.id,
    });

    expect(
      (await call("DELETE", `/api/v1/cost-budgets/${budget.id}`)).res.status,
    ).toBe(204);
    expect(
      (await call("GET", `/api/v1/cost-budgets/${budget.id}`)).res.status,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/v1/cost-budgets/${budget.id}`)).res.status,
    ).toBe(404);
  });

  it("refuses bad input and a second budget for the same scope", async () => {
    const { call, budget } = await setup();
    await budget();
    const same = await call("POST", "/api/v1/cost-budgets", {
      json: { category: "groceries", period: "month", amountMinor: 1 },
    });
    expect(same.res.status).toBe(409);
    expect(errorCode(same)).toBe("conflict");
    for (const json of [
      { period: "month", amountMinor: 100 },
      { category: null, bookId: null, period: "month", amountMinor: 100 },
      { category: "groceries", period: "week", amountMinor: 100 },
      { category: "groceries", period: "month", amountMinor: 0 },
      { category: "groceries", period: "month", amountMinor: -5 },
      { category: "groceries", period: "month", amountMinor: 1.5 },
      { category: "nonsense", period: "month", amountMinor: 100 },
      {
        category: "dining",
        period: "month",
        amountMinor: 100,
        currency: "EUR",
      },
      { bookId: "nope", period: "month", amountMinor: 100 },
    ]) {
      const r = await call("POST", "/api/v1/cost-budgets", { json });
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
    const second = await budget({ category: "dining" });
    const clash = await call("PATCH", `/api/v1/cost-budgets/${second.id}`, {
      json: { category: "groceries" },
    });
    expect(clash.res.status).toBe(409);
    const noScope = await call("PATCH", `/api/v1/cost-budgets/${second.id}`, {
      json: { category: null },
    });
    expect(noScope.res.status).toBe(400);
    expect(
      (await call("PATCH", `/api/v1/cost-budgets/${second.id}`, { json: {} }))
        .res.status,
    ).toBe(400);
  });

  it("reports where the active budgets stand", async () => {
    const { call, budget, cost } = await setup();
    await budget({ amountMinor: 20000 });
    await budget({ category: "dining", period: "year", amountMinor: 100000 });
    const paused = await budget({ category: "travel", amountMinor: 1 });
    await call("PATCH", `/api/v1/cost-budgets/${paused.id}`, {
      json: { active: false },
    });
    await cost({ amountMinor: 16000, date: "2026-03-05" });
    await cost({ amountMinor: 5000, date: "2026-04-05" });
    await cost({ amountMinor: 30000, category: "dining", date: "2026-01-05" });

    const march = await call(
      "GET",
      "/api/v1/costs/budgets/status?year=2026&month=3",
    );
    expect(march.res.status).toBe(200);
    const body = march.body as Status;
    expect(body).toMatchObject({
      year: 2026,
      month: 3,
      currency: "CHF",
      warningPercent: 80,
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      periodFrom: "2026-03-01",
      periodTo: "2026-03-31",
      spentMinor: 16000,
      entryCount: 1,
      remainingMinor: 4000,
      percentUsed: 80,
      state: "warning",
      budget: { category: "groceries" },
    });
    expect(body.items[1]).toMatchObject({
      periodFrom: "2026-01-01",
      periodTo: "2026-12-31",
      spentMinor: 30000,
      percentUsed: 30,
      state: "ok",
    });
    const april = (
      (await call("GET", "/api/v1/costs/budgets/status?year=2026&month=4"))
        .body as Status
    ).items[0];
    expect(april).toMatchObject({ spentMinor: 5000, state: "ok" });
  });

  it("defaults the year and the month to today, and refuses nonsense", async () => {
    const { call } = await setup();
    const now = (await call("GET", "/api/v1/costs/budgets/status"))
      .body as Status;
    expect(now.year).toBeGreaterThanOrEqual(2026);
    expect(now.month).toBeGreaterThanOrEqual(1);
    expect(now.month).toBeLessThanOrEqual(12);
    for (const q of [
      "month=0",
      "month=13",
      "month=x",
      "year=1800",
      "year=2300",
    ]) {
      const r = await call("GET", `/api/v1/costs/budgets/status?${q}`);
      expect(r.res.status, q).toBe(400);
    }
  });

  it("needs costs:write to change budgets and read to see them or their status", async () => {
    const { anna, budget } = await setup();
    const made = await budget();
    const readOnly = createCaller({
      bearer: createTestToken(anna, { scopes: ["read"] }).token,
    });
    expect((await readOnly("GET", "/api/v1/cost-budgets")).res.status).toBe(
      200,
    );
    expect(
      (await readOnly("GET", "/api/v1/costs/budgets/status")).res.status,
    ).toBe(200);
    expect(
      (
        await readOnly("POST", "/api/v1/cost-budgets", {
          json: { category: "dining", period: "month", amountMinor: 1 },
        })
      ).res.status,
    ).toBe(403);
    expect(
      (await readOnly("DELETE", `/api/v1/cost-budgets/${made.id}`)).res.status,
    ).toBe(403);
  });
});
