import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type {
  CostBudget,
  CostBudgetStatusItem,
} from "$lib/api/schemas/cost-budgets";
import BudgetCard from "./budget-card.svelte";

const budget: CostBudget = {
  id: "b1",
  bookId: "book1",
  bookName: "Haushalt",
  category: "groceries",
  period: "month",
  amountMinor: 40000,
  currency: "CHF",
  active: true,
  createdAt: "2026-01-01T08:00:00.000Z",
  updatedAt: "2026-01-01T08:00:00.000Z",
};

const item = (over: Partial<CostBudgetStatusItem>): CostBudgetStatusItem => ({
  budget,
  periodFrom: "2026-10-01",
  periodTo: "2026-10-31",
  spentMinor: 18000,
  entryCount: 4,
  remainingMinor: 22000,
  percentUsed: 45,
  state: "ok",
  ...over,
});

const html = (over: Partial<CostBudgetStatusItem>, canWrite = false) =>
  render(BudgetCard as never, {
    props: {
      item: item(over),
      canWrite,
      onedit: () => {},
      onpause: () => {},
      ondelete: () => {},
    } as never,
  }).body.replace(/[\u00a0\u202f]/g, " ");

describe("BudgetCard", () => {
  it("names the budget, the amounts and the progress in words", () => {
    const body = html({});
    expect(body).toContain("Lebensmittel");
    expect(body).toContain("Haushalt");
    expect(body).toContain("CHF 180.00");
    expect(body).toContain("von CHF 400.00");
    expect(body).toContain("Im Rahmen");
    expect(body).toContain("45 %");
    expect(body).toContain("Noch CHF 220.00");
    expect(body).toContain('role="progressbar"');
    expect(body).toContain('aria-valuenow="45"');
    expect(body).toContain("Im Rahmen: 45 % verbraucht");
  });

  it("says a budget is nearly used up in words and in the warning colour", () => {
    const body = html({
      state: "warning",
      percentUsed: 85,
      spentMinor: 34000,
      remainingMinor: 6000,
    });
    expect(body).toContain("Fast aufgebraucht");
    expect(body).toContain("text-warning");
    expect(body).toContain('data-state="warning"');
  });

  it("says a budget is exceeded, fills the bar and names the overspend", () => {
    const body = html({
      state: "exceeded",
      percentUsed: 130,
      spentMinor: 52000,
      remainingMinor: -12000,
    });
    expect(body).toContain("Überschritten");
    expect(body).toContain("130 %");
    expect(body).toContain("CHF 120.00 über dem Budget");
    expect(body).toContain('aria-valuenow="100"');
    expect(body).toContain("text-destructive");
  });

  it("links to the entries it measured, and only when there are some", () => {
    expect(html({})).toContain(
      'href="/costs?book=book1&amp;year=2026&amp;month=10&amp;category=groceries"',
    );
    expect(html({ entryCount: 0 })).not.toContain("Einträge ansehen");
  });

  it("offers the menu only to people who may change budgets", () => {
    expect(html({})).not.toContain("Aktionen für das Budget");
    expect(html({}, true)).toContain("Aktionen für das Budget");
  });
});
