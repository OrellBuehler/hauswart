import { describe, expect, it } from "vitest";
import { useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("cost reads and the books", () => {
  const mcp = useMcp();

  it("marks the entries of a tax relevant book and leaves the mark out elsewhere", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_cost", {
      title: "Dachrinne",
      amount: "100",
      category: "maintenance",
      book: "Wohnung",
    });
    await ok("create_cost", {
      title: "Einkauf",
      amount: "20",
      category: "groceries",
      book: "Haushalt",
    });
    const { costs } = await ok("list_costs");
    const by = Object.fromEntries(
      costs.map((c: { title: string }) => [c.title, c]),
    );
    expect(by.Dachrinne.bookTaxRelevant).toBe(true);
    expect(by.Einkauf.bookTaxRelevant).toBeUndefined();
  });

  it("says that a view of one book leaves out the payments across all books", async () => {
    const { ok, ben, anna } = await mcp.connect({ scopes: [...ALL] });
    await ok("record_settlement", { to: anna.id, from: ben.id, amount: "50" });
    await ok("record_settlement", {
      to: anna.id,
      from: ben.id,
      amount: "5",
      book: "Haushalt",
    });
    const one = await ok("get_balances", { book: "Haushalt" });
    expect(one.paymentsAcrossAllBooksLeftOut).toEqual({
      count: 1,
      total: "50.00 CHF",
    });
    const all = await ok("get_balances");
    expect(all.paymentsAcrossAllBooksLeftOut).toBeUndefined();
  });

  it("answers an unknown book with the books there are", async () => {
    const { call } = await mcp.connect({ scopes: ["read"] });
    const reply = await call("list_costs", { book: "Segeln" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[not_found]");
  });
});
