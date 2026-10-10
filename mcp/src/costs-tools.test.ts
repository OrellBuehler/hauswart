import { describe, expect, it } from "vitest";
import { ToolError } from "./errors";
import { createVehicle, useMcp } from "./test-harness";
import { rate, toMinor } from "./tools/costs";

const ALL = ["read", "write", "costs:write"] as const;

describe("cost tools", () => {
  const mcp = useMcp();

  it("books a cost from a decimal amount, paid by the token's user, split by ownership", async () => {
    const { ok, anna } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_asset", { name: "Dishwasher" });
    const cost = await ok("create_cost", {
      title: "Pump replaced",
      amount: "1'234.50",
      category: "repair",
      asset: "Dishwasher",
      payee: "Example Plumbing AG",
      date: "2026-03-10",
      deductible: "maintenance",
    });
    expect(cost).toMatchObject({
      title: "Pump replaced",
      amount: "1234.50 CHF",
      category: "repair",
      paidBy: "Anna",
      split: "ownership",
      asset: "Dishwasher",
      payee: "Example Plumbing AG",
      deductible: "maintenance",
      date: "2026-03-10",
    });
    expect(cost.shares).toHaveLength(2);
    expect(cost.shares.map((s: string) => s.split(": ")[1]).sort()).toEqual([
      "617.25 CHF",
      "617.25 CHF",
    ]);
    expect(anna.id).toBeTruthy();
  });

  it("books a refund, an unshared cost and a payment by somebody else", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    const refund = await ok("create_cost", {
      title: "Refund",
      amount: "-20.05",
      category: "repair",
    });
    expect(refund.amount).toBe("-20.05 CHF");
    const own = await ok("create_cost", {
      title: "Mine",
      amount: "5",
      category: "other",
      split: "none",
    });
    expect(own.split).toBe("none");
    expect(own.shares).toBeUndefined();
    const ben = await ok("create_cost", {
      title: "Bens",
      amount: "10.00",
      category: "other",
      paidBy: "Ben",
    });
    expect(ben.paidBy).toBe("Ben");
  });

  it("does not count a mortgage repayment as an expense", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    const c = await ok("create_cost", {
      title: "Amortisation",
      amount: "2000",
      category: "mortgage_principal",
    });
    expect(c.countsAsExpense).toBe(false);
    const s = await ok("cost_summary", {});
    expect(s.expenseTotal).toBe("0.00 CHF");
    expect(s.equityTotal).toBe("2000.00 CHF");
  });

  it.each(["abc", "1.234", "12,3,4", "1e5", ""])(
    "rejects the amount %j",
    async (amount) => {
      const { call } = await mcp.connect({ scopes: [...ALL] });
      const reply = await call("create_cost", {
        title: "x",
        amount,
        category: "other",
      });
      expect(reply.isError).toBe(true);
    },
  );

  it("rejects a wrong currency, category and a missing name", async () => {
    const { call } = await mcp.connect({ scopes: [...ALL] });
    expect(
      (
        await call("create_cost", {
          title: "x",
          amount: "1",
          category: "luxury",
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call("create_cost", {
          title: "x",
          amount: "1",
          category: "other",
          currency: "chf",
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call("create_cost", {
          title: "x",
          amount: "1",
          category: "other",
          asset: "Nothing",
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call("create_cost", {
          title: "x",
          amount: "1",
          category: "other",
          paidBy: "Nobody",
        })
      ).isError,
    ).toBe(true);
  });

  it("uses the currency's own precision", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    const c = await ok("create_cost", {
      title: "Yen",
      amount: "1500",
      currency: "JPY",
      category: "other",
    });
    expect(c.amount).toBe("1500 JPY");
  });

  it("lists and filters, and summarises with the settlement", async () => {
    const { ok, call } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_cost", {
      title: "Heating",
      amount: "100.00",
      category: "utilities",
      date: "2026-02-01",
    });
    await ok("create_cost", {
      title: "Repair",
      amount: "40.00",
      category: "repair",
      paidBy: "Ben",
      date: "2026-03-01",
    });
    await ok("create_cost", {
      title: "Old",
      amount: "9.00",
      category: "other",
      date: "2025-03-01",
    });

    expect(
      (await ok("list_costs", { year: 2026 })).costs.map(
        (c: { title: string }) => c.title,
      ),
    ).toEqual(["Repair", "Heating"]);
    expect(
      (await ok("list_costs", { category: "utilities" })).costs,
    ).toHaveLength(1);
    expect((await ok("list_costs", { paidBy: "Ben" })).costs[0].title).toBe(
      "Repair",
    );
    expect((await ok("list_costs", { q: "old" })).costs).toHaveLength(1);
    const page = await ok("list_costs", { limit: 1 });
    expect(page.nextCursor).toBeTruthy();
    expect(
      (await ok("list_costs", { limit: 5, cursor: page.nextCursor })).costs
        .length,
    ).toBe(2);

    const summary = await call("cost_summary", { year: 2026 });
    expect(summary.summary).toContain("2026: 140.00 CHF in expenses");
    expect(summary.summary).toContain("Ben owes Anna 30.00 CHF");
    expect(summary.json).toMatchObject({
      expenseTotal: "140.00 CHF",
      settlement: [{ from: "Ben", to: "Anna", amount: "30.00 CHF" }],
    });
    const none = await call("cost_summary", { year: 2020 });
    expect(none.summary).toContain("nothing to settle");
  });

  it("summarises the costs of one asset, given by name or plate", async () => {
    const session = await mcp.connect({ scopes: [...ALL] });
    const { ok, call } = session;
    await ok("create_asset", { name: "Dishwasher" });
    await createVehicle(session, "Familienauto", "ZH 000000");
    const book = (extra: Record<string, unknown>) =>
      ok("create_cost", { category: "repair", ...extra });
    await book({
      title: "Pump",
      amount: "100.00",
      asset: "Dishwasher",
      date: "2026-02-01",
    });
    await book({
      title: "Brakes",
      amount: "40.00",
      asset: "Familienauto",
      date: "2026-03-01",
    });
    await book({
      title: "Heating",
      amount: "60.00",
      category: "utilities",
      date: "2026-03-05",
    });

    expect((await ok("cost_summary", { year: 2026 })).expenseTotal).toBe(
      "200.00 CHF",
    );
    const car = await call("cost_summary", { year: 2026, asset: "zh000000" });
    expect(car.summary).toContain("2026 (Familienauto): 40.00 CHF in expenses");
    expect(car.json).toMatchObject({
      expenseTotal: "40.00 CHF",
      byCategory: [{ category: "repair", total: "40.00 CHF", count: 1 }],
      topAssets: [{ asset: "Familienauto", total: "40.00 CHF", count: 1 }],
    });
    expect(
      (await ok("cost_summary", { year: 2026, asset: "Dishwasher" }))
        .expenseTotal,
    ).toBe("100.00 CHF");
    const missing = await call("cost_summary", { asset: "Traktor" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Error [not_found]");
  });

  it("shows write tools only with costs:write, and reading needs no more than read", async () => {
    const reader = await mcp.connect({ scopes: ["read"] });
    expect((await reader.ok("list_costs")).costs).toEqual([]);
    expect((await reader.ok("cost_summary")).currency).toBe("CHF");
    const names = (await reader.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_costs");
    expect(names).not.toContain("create_cost");
    const writer = await mcp.connect({ scopes: ["read", "write"] });
    expect(
      (await writer.client.listTools()).tools.map((t) => t.name),
    ).not.toContain("create_cost");
  });
});

describe("amounts in the cost tools", () => {
  it.each([
    [184.7, "CHF", "l", "1.847 CHF/l"],
    [12.3, "CHF", "km", "0.123 CHF/km"],
    [0, "CHF", "kWh", "0.000 CHF/kWh"],
    [175.4, "JPY", "l", "175.4 JPY/l"],
    [1847, "KWD", "l", "1.8470 KWD/l"],
  ])("writes the rate %s %s per %s as %s", (value, currency, per, text) => {
    expect(rate(value, currency, per)).toBe(text);
  });

  it.each([
    ["12.5", "CHF", 1250],
    ["1'234,50", "CHF", 123_450],
    ["1500", "JPY", 1500],
    ["0", "CHF", 0],
    ["-20.05", "CHF", -2005],
  ])("reads %s %s as %s minor units", (amount, currency, expected) => {
    expect(toMinor(amount, currency)).toBe(expected);
  });

  it.each(["cheap", "1.234", ""])("refuses the amount '%s'", (amount) => {
    expect(() => toMinor(amount, "CHF")).toThrow(ToolError);
    try {
      toMinor(amount, "CHF");
    } catch (err) {
      expect((err as ToolError).code).toBe("invalid_request");
    }
  });
});
