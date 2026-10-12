import { describe, expect, it } from "vitest";
import { createCostRecurrenceRequestSchema } from "../../src/lib/api/schemas/cost-recurrences";
import { createCostRecurrence } from "../../src/lib/server/costs/recurrences";
import { createCostTag } from "../../src/lib/server/costs/tags";
import { ctxAt } from "../../src/lib/testing/domain";
import { useMcp } from "./test-harness";

describe("list_cost_recurrences", () => {
  const mcp = useMcp();
  const recurrence = (json: Record<string, unknown>) =>
    createCostRecurrence(
      ctxAt(mcp.db.db),
      createCostRecurrenceRequestSchema.parse({
        title: "Miete",
        amountMinor: 150000,
        category: "other",
        frequency: "monthly",
        startDate: "2099-01-31",
        splitMode: "none",
        ...json,
      }),
      null,
    );

  it("says there are none", async () => {
    const { call, ok } = await mcp.connect({ scopes: ["read"] });
    expect((await call("list_cost_recurrences")).summary).toBe(
      "0 recurring costs.",
    );
    expect((await ok("list_cost_recurrences")).recurrences).toEqual([]);
  });

  it("describes the schedule in words, with amounts as decimals", async () => {
    const { ok } = await mcp.connect({ scopes: ["read"] });
    const tag = createCostTag(ctxAt(mcp.db.db), { name: "Fix" });
    recurrence({ dayOfMonth: 31, tagIds: [tag.id], payee: "Verwaltung" });
    recurrence({
      title: "Prämie",
      frequency: "quarterly",
      interval: 2,
      amountMinor: 24990,
      category: "insurance",
      startDate: "2099-02-15",
      endDate: "2101-12-31",
    });
    recurrence({ title: "Abo", frequency: "yearly", startDate: "2099-03-05" });
    const { recurrences } = await ok("list_cost_recurrences");
    expect(recurrences).toHaveLength(3);
    const by = (t: string) =>
      recurrences.find((r: { title: string }) => r.title === t);
    expect(by("Miete")).toMatchObject({
      amount: "1500.00 CHF",
      book: "Wohnung",
      schedule:
        "every month on day 31 (the last day of shorter months), from 2099-01-31",
      next: "2099-01-31",
      tags: ["Fix"],
      payee: "Verwaltung",
    });
    expect(by("Miete").status).toBeUndefined();
    expect(by("Prämie")).toMatchObject({
      schedule: "every 2 quarters on day 15, from 2099-02-15 to 2101-12-31",
      amount: "249.90 CHF",
    });
    expect(by("Abo").schedule).toBe("every year on day 5, from 2099-03-05");
  });

  it("shows paused and finished ones, and filters on active", async () => {
    const { ok, call } = await mcp.connect({ scopes: ["read"] });
    recurrence({ title: "Läuft" });
    recurrence({ title: "Pause", active: false });
    const all = await ok("list_cost_recurrences");
    expect(
      all.recurrences.map((r: { title: string; status?: string }) => [
        r.title,
        r.status ?? "active",
      ]),
    ).toEqual([
      ["Läuft", "active"],
      ["Pause", "paused"],
    ]);
    const only = await ok("list_cost_recurrences", { active: true });
    expect(only.recurrences.map((r: { title: string }) => r.title)).toEqual([
      "Läuft",
    ]);
    const paused = await ok("list_cost_recurrences", { active: false });
    expect(paused.recurrences.map((r: { title: string }) => r.title)).toEqual([
      "Pause",
    ]);
    expect((await call("list_cost_recurrences")).summary).toBe(
      "2 recurring costs.",
    );
  });
});
