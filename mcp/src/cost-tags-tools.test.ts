import { describe, expect, it } from "vitest";
import { createCostTag } from "../../src/lib/server/costs/tags";
import { ctxAt } from "../../src/lib/testing/domain";
import { useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("cost tag tools", () => {
  const mcp = useMcp();
  const tag = (name: string, color?: "blue") =>
    createCostTag(ctxAt(mcp.db.db), { name, color });

  it("lists the tags by name with their colour and number of entries", async () => {
    const { call, ok } = await mcp.connect({ scopes: ["read"] });
    expect((await call("list_cost_tags")).summary).toBe("0 cost tags.");
    tag("Steuern");
    tag("Ferien", "blue");
    const reply = await call("list_cost_tags");
    expect(reply.summary).toBe("2 cost tags.");
    expect((await ok("list_cost_tags")).tags).toEqual([
      expect.objectContaining({ name: "Ferien", color: "blue", entries: 0 }),
      expect.objectContaining({ name: "Steuern", color: "gray", entries: 0 }),
    ]);
  });

  it("books an entry with tags given by name (any case) or id, and shows them on the rows", async () => {
    const { ok, today } = await mcp.connect({ scopes: [...ALL] });
    const ferien = tag("Ferien");
    tag("Steuern");
    const booked = await ok("create_cost", {
      title: "Zug",
      amount: "42.50",
      category: "transport",
      tags: ["ferien", "STEUERN"],
    });
    expect(booked.tags).toEqual(["Ferien", "Steuern"]);
    const byId = await ok("create_cost", {
      title: "Hotel",
      amount: "100",
      category: "travel",
      tags: [ferien.id],
    });
    expect(byId.tags).toEqual(["Ferien"]);
    await ok("create_cost", {
      title: "Ohne",
      amount: "1",
      category: "other",
    });
    const year = Number(today.slice(0, 4));
    const all = (await ok("list_costs", { year })).costs;
    expect(all).toHaveLength(3);
    expect(
      all.find((c: { title: string }) => c.title === "Ohne").tags,
    ).toBeUndefined();
    expect((await ok("list_cost_tags")).tags).toEqual([
      expect.objectContaining({ name: "Ferien", entries: 2 }),
      expect.objectContaining({ name: "Steuern", entries: 1 }),
    ]);
  });

  it("filters the list and the summary by tag", async () => {
    const { ok, today } = await mcp.connect({ scopes: [...ALL] });
    tag("Ferien");
    await ok("create_cost", {
      title: "Zug",
      amount: "40",
      category: "transport",
      tags: ["Ferien"],
    });
    await ok("create_cost", {
      title: "Brot",
      amount: "5",
      category: "groceries",
    });
    const year = Number(today.slice(0, 4));
    const only = await ok("list_costs", { year, tag: "ferien" });
    expect(only.costs.map((c: { title: string }) => c.title)).toEqual(["Zug"]);
    const summary = await ok("cost_summary", { year, tag: "Ferien" });
    expect(summary.expenseTotal).toBe("40.00 CHF");
  });

  it("says which tags exist when one does not, and books nothing", async () => {
    const { call, ok, today } = await mcp.connect({ scopes: [...ALL] });
    tag("Ferien");
    const reply = await call("create_cost", {
      title: "x",
      amount: "1",
      category: "other",
      tags: ["Urlaub"],
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('No cost tag "Urlaub"');
    expect(reply.text).toContain("Ferien");
    const year = Number(today.slice(0, 4));
    expect((await ok("list_costs", { year })).costs).toEqual([]);
    expect((await call("list_costs", { tag: "Urlaub" })).isError).toBe(true);
  });
});
