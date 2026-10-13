import { describe, expect, it } from "vitest";
import { createCostBudgetRequestSchema } from "../../src/lib/api/schemas/cost-budgets";
import { createCostBudget } from "../../src/lib/server/costs/budgets";
import { ctxAt } from "../../src/lib/testing/domain";
import { useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("get_budget_status", () => {
  const mcp = useMcp();
  const budget = (json: Record<string, unknown>) =>
    createCostBudget(
      ctxAt(mcp.db.db),
      createCostBudgetRequestSchema.parse({ period: "month", ...json }),
    );

  it("says there are no budgets", async () => {
    const { call, ok } = await mcp.connect({ scopes: ["read"] });
    expect((await call("get_budget_status")).summary).toMatch(
      /^0 active budgets for \d{4}-\d{2}\.$/,
    );
    expect((await ok("get_budget_status")).budgets).toEqual([]);
  });

  it("lists the budgets with the most used first, amounts as decimals, and counts what was booked", async () => {
    const { ok, call, today } = await mcp.connect({ scopes: [...ALL] });
    budget({ category: "groceries", amountMinor: 50000 });
    budget({ category: "dining", amountMinor: 20000 });
    budget({ category: "travel", period: "year", amountMinor: 100000 });
    await ok("create_cost", {
      title: "Einkauf",
      amount: "450.00",
      category: "groceries",
      split: "none",
    });
    await ok("create_cost", {
      title: "Essen",
      amount: "230.50",
      category: "dining",
      split: "none",
    });
    await ok("create_cost", {
      title: "Zug",
      amount: "10",
      category: "travel",
      split: "none",
    });
    const reply = await call("get_budget_status");
    expect(reply.summary).toBe(
      `3 active budgets for ${today.slice(0, 7)}: 2 at 80 % or more.`,
    );
    const { budgets } = await ok("get_budget_status");
    expect(
      budgets.map((b: { category: string; state: string }) => [
        b.category,
        b.state,
      ]),
    ).toEqual([
      ["dining", "exceeded"],
      ["groceries", "warning"],
      ["travel", "ok"],
    ]);
    expect(budgets[0]).toMatchObject({
      budget: "200.00 CHF",
      spent: "230.50 CHF",
      remaining: "-30.50 CHF",
      percentUsed: 115,
      period: "month",
    });
    expect(budgets[2]).toMatchObject({ period: "year", percentUsed: 1 });
  });

  it("measures another month when asked", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    budget({ category: "groceries", amountMinor: 50000 });
    await ok("create_cost", {
      title: "Einkauf",
      amount: "100",
      category: "groceries",
      date: "2025-02-10",
      split: "none",
    });
    const feb = await ok("get_budget_status", { year: 2025, month: 2 });
    expect(feb.budgets[0]).toMatchObject({
      from: "2025-02-01",
      to: "2025-02-28",
      spent: "100.00 CHF",
    });
    const mar = await ok("get_budget_status", { year: 2025, month: 3 });
    expect(mar.budgets[0]).toMatchObject({ spent: "0.00 CHF" });
  });
});
