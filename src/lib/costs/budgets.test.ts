import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import type {
  CostBudget,
  CostBudgetStatusItem,
} from "$lib/api/schemas/cost-budgets";
import {
  budgetAlertText,
  budgetDisplay,
  budgetEntriesQuery,
  budgetSaveErrors,
  budgetScope,
  budgetStatusQuery,
  budgetViewLabel,
  budgetViewQuery,
  buildBudgetCreateBody,
  buildBudgetUpdateBody,
  draftFromBudget,
  isCurrentView,
  itemsForPeriod,
  newBudgetDraft,
  parseBudgetView,
  shiftBudgetView,
  type BudgetDraft,
} from "./budgets";

const TODAY = "2026-10-12";

const budget = (over: Partial<CostBudget> = {}): CostBudget => ({
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
  ...over,
});

const item = (
  over: Partial<CostBudgetStatusItem> = {},
  budgetOver: Partial<CostBudget> = {},
): CostBudgetStatusItem => ({
  budget: budget(budgetOver),
  periodFrom: "2026-10-01",
  periodTo: "2026-10-31",
  spentMinor: 18000,
  entryCount: 7,
  remainingMinor: 22000,
  percentUsed: 45,
  state: "ok",
  ...over,
});

describe("the view of the budgets page", () => {
  const parse = (qs: string) => parseBudgetView(new URLSearchParams(qs), TODAY);

  it("is this month without any parameter", () => {
    expect(parse("")).toEqual({ period: "month", year: 2026, month: 10 });
    expect(budgetViewQuery(parse(""), TODAY)).toBe("");
  });

  it("round-trips a month, a year and the way back from a year to a month", () => {
    for (const qs of [
      "year=2025&month=3",
      "period=year&year=2025",
      "period=year&year=2025&month=3",
      "month=2",
    ]) {
      const view = parse(qs);
      expect(parse(budgetViewQuery(view, TODAY).slice(1))).toEqual(view);
    }
    expect(budgetViewQuery(parse("period=year"), TODAY)).toBe("?period=year");
    expect(budgetViewQuery(parse("year=2025&month=3"), TODAY)).toBe(
      "?year=2025&month=3",
    );
  });

  it("ignores what is not a month or a year", () => {
    expect(parse("year=abc&month=13&period=week")).toEqual({
      period: "month",
      year: 2026,
      month: 10,
    });
    expect(parse("year=1800").year).toBe(2026);
    expect(parse("month=0").month).toBe(10);
    expect(parse("month=1.5").month).toBe(10);
  });

  it("moves by months across a year end, and by years in a year view", () => {
    expect(
      shiftBudgetView({ period: "month", year: 2026, month: 1 }, -1),
    ).toEqual({ period: "month", year: 2025, month: 12 });
    expect(
      shiftBudgetView({ period: "month", year: 2026, month: 12 }, 1),
    ).toEqual({ period: "month", year: 2027, month: 1 });
    expect(
      shiftBudgetView({ period: "year", year: 2026, month: 5 }, -1),
    ).toEqual({ period: "year", year: 2025, month: 5 });
  });

  it("stops where the API stops", () => {
    expect(
      shiftBudgetView({ period: "year", year: 1990, month: 1 }, -1),
    ).toBeNull();
    expect(
      shiftBudgetView({ period: "month", year: 2200, month: 12 }, 1),
    ).toBeNull();
    expect(
      shiftBudgetView({ period: "month", year: 1990, month: 2 }, -1),
    ).not.toBeNull();
  });

  it("asks the status for both the year and the month", () => {
    expect(budgetStatusQuery({ period: "year", year: 2025, month: 3 })).toEqual(
      { year: 2025, month: 3 },
    );
  });

  it("names the month or the year", () => {
    expect(budgetViewLabel({ period: "month", year: 2026, month: 10 })).toBe(
      "Oktober 2026",
    );
    expect(budgetViewLabel({ period: "year", year: 2026, month: 10 })).toBe(
      "2026",
    );
  });

  it("knows the view that holds today", () => {
    expect(isCurrentView(parse(""), TODAY)).toBe(true);
    expect(isCurrentView(parse("month=9"), TODAY)).toBe(false);
    expect(isCurrentView(parse("year=2025"), TODAY)).toBe(false);
    expect(isCurrentView(parse("period=year&month=3"), TODAY)).toBe(true);
    expect(isCurrentView(parse("period=year&year=2025"), TODAY)).toBe(false);
  });
});

describe("the budgets of a period", () => {
  it("keeps one period type and puts what needs attention first, the most used before the rest", () => {
    const items = [
      item({ percentUsed: 10, state: "ok" }, { id: "a" }),
      item({ percentUsed: 85, state: "warning" }, { id: "b" }),
      item({ percentUsed: 130, state: "exceeded" }, { id: "c" }),
      item({ percentUsed: 120, state: "exceeded" }, { id: "d" }),
      item({ percentUsed: 50, state: "ok" }, { id: "e" }),
      item({ percentUsed: 99, state: "warning" }, { id: "f", period: "year" }),
    ];
    expect(itemsForPeriod(items, "month").map((i) => i.budget.id)).toEqual([
      "c",
      "d",
      "b",
      "e",
      "a",
    ]);
    expect(itemsForPeriod(items, "year").map((i) => i.budget.id)).toEqual([
      "f",
    ]);
    expect(itemsForPeriod([], "month")).toEqual([]);
  });

  it("words the alert, and says nothing while every budget is within its amount", () => {
    expect(budgetAlertText({ exceeded: 0, warning: 0 })).toBe("");
    expect(budgetAlertText({ exceeded: 1, warning: 0 })).toBe(
      "1 Budget überschritten",
    );
    expect(budgetAlertText({ exceeded: 3, warning: 0 })).toBe(
      "3 Budgets überschritten",
    );
    expect(budgetAlertText({ exceeded: 0, warning: 2 })).toBe(
      "2 Budgets fast aufgebraucht",
    );
    expect(budgetAlertText({ exceeded: 2, warning: 1 })).toBe(
      "2 Budgets überschritten, 1 fast aufgebraucht",
    );
  });
});

describe("what a budget is for", () => {
  it("names the category and the book", () => {
    expect(budgetScope(budget())).toEqual({
      title: "Lebensmittel",
      subtitle: "Haushalt",
    });
  });

  it("says 'all' for the half that is open", () => {
    expect(budgetScope(budget({ bookId: null, bookName: null }))).toEqual({
      title: "Lebensmittel",
      subtitle: "Alle Bücher",
    });
    expect(budgetScope(budget({ category: null }))).toEqual({
      title: "Haushalt",
      subtitle: "Alle Kategorien",
    });
  });
});

describe("how a budget is shown", () => {
  it("shows a budget within its amount", () => {
    const display = budgetDisplay(item());
    expect(display.state).toBe("ok");
    expect(display.stateLabel).toBe("Im Rahmen");
    expect(display.barPercent).toBe(45);
    expect(display.percentText).toBe("45 %");
    expect(display.spentText).toContain("180.00");
    expect(display.amountText).toContain("400.00");
    expect(display.remainingText).toMatch(/^Noch .*220\.00/);
  });

  it("says in words, not only in colour, that a budget is nearly used up or over", () => {
    const warning = budgetDisplay(
      item({
        state: "warning",
        percentUsed: 85,
        spentMinor: 34000,
        remainingMinor: 6000,
      }),
    );
    expect(warning.stateLabel).toBe("Fast aufgebraucht");
    expect(warning.summary).toContain("Fast aufgebraucht");
    expect(warning.summary).toContain("85 %");
    const over = budgetDisplay(
      item({
        state: "exceeded",
        percentUsed: 130,
        spentMinor: 52000,
        remainingMinor: -12000,
      }),
    );
    expect(over.stateLabel).toBe("Überschritten");
    expect(over.remainingText).toMatch(/120\.00.*über dem Budget$/);
    expect(over.summary).toContain("Überschritten");
  });

  it("fills the bar to the top at most, but keeps the real percentage in the text", () => {
    const over = budgetDisplay(item({ state: "exceeded", percentUsed: 250 }));
    expect(over.barPercent).toBe(100);
    expect(over.percentText).toBe("250 %");
  });

  it("leaves the bar empty when refunds outweigh the expenses", () => {
    const refunded = budgetDisplay(
      item({ spentMinor: -2000, percentUsed: 0, remainingMinor: 42000 }),
    );
    expect(refunded.barPercent).toBe(0);
    expect(refunded.spentText).toContain("20.00");
    expect(refunded.remainingText).toMatch(/^Noch .*420\.00/);
  });

  it("shows the amounts in the budget's own currency", () => {
    expect(budgetDisplay(item({}, { currency: "EUR" })).amountText).toContain(
      "EUR",
    );
  });

  it("is worded in English too", () => {
    expect(
      budgetDisplay(item({ state: "warning" })).stateLabel.length,
    ).toBeGreaterThan(0);
  });
});

describe("opening the entries a budget measured", () => {
  it("narrows to the month, the book and the category", () => {
    expect(budgetEntriesQuery(item())).toBe(
      "?book=book1&year=2026&month=10&category=groceries",
    );
  });

  it("covers the whole year for a yearly budget, every book without one", () => {
    expect(
      budgetEntriesQuery(
        item(
          { periodFrom: "2026-01-01", periodTo: "2026-12-31" },
          { period: "year", bookId: null, bookName: null, category: null },
        ),
      ),
    ).toBe("?book=all&year=2026");
  });
});

describe("the budget form", () => {
  const draft = (over: Partial<BudgetDraft> = {}): BudgetDraft => ({
    ...newBudgetDraft({ bookId: "book1" }),
    category: "groceries",
    amount: "400",
    ...over,
  });

  it("starts in the book on screen, monthly and active", () => {
    expect(newBudgetDraft({})).toEqual({
      bookId: "",
      category: "",
      period: "month",
      amount: "",
      active: true,
    });
    expect(newBudgetDraft({ bookId: "b", period: "year" })).toMatchObject({
      bookId: "b",
      period: "year",
    });
  });

  it("reads a budget into the form and back without a change", () => {
    const b = budget({ amountMinor: 123450 });
    const d = draftFromBudget(b);
    expect(d).toEqual({
      bookId: "book1",
      category: "groceries",
      period: "month",
      amount: "1234.50",
      active: true,
    });
    expect(buildBudgetUpdateBody(d, b, "CHF").body).toEqual({});
  });

  it("builds the request for a new budget in minor units", () => {
    expect(buildBudgetCreateBody(draft(), "CHF").body).toEqual({
      bookId: "book1",
      category: "groceries",
      period: "month",
      amountMinor: 40000,
      active: true,
    });
    expect(
      buildBudgetCreateBody(draft({ bookId: "", amount: "1'500.5" }), "CHF")
        .body,
    ).toEqual({
      category: "groceries",
      period: "month",
      amountMinor: 150050,
      active: true,
    });
  });

  it("needs a book or a category, and a positive amount", () => {
    const scope = buildBudgetCreateBody(
      draft({ bookId: "", category: "" }),
      "CHF",
    );
    expect(scope.body).toBeUndefined();
    expect(scope.errors.bookId).toBe(
      "Wähle ein Buch, eine Kategorie oder beides.",
    );
    expect(
      buildBudgetCreateBody(draft({ amount: "" }), "CHF").errors,
    ).toHaveProperty("amountMinor");
    expect(
      buildBudgetCreateBody(draft({ amount: "0" }), "CHF").errors,
    ).toHaveProperty("amountMinor");
    expect(
      buildBudgetCreateBody(draft({ amount: "abc" }), "CHF").errors,
    ).toHaveProperty("amountMinor");
  });

  it("refuses a negative amount, which no budget can be", () => {
    const built = buildBudgetCreateBody(draft({ amount: "-5" }), "CHF");
    expect(built.body).toBeUndefined();
    expect(built.errors.amountMinor).toBe(
      "Der Höchstbetrag muss grösser als 0 sein.",
    );
  });

  it("sends only what changed, and null takes a half of the scope away", () => {
    const b = budget();
    const base = draftFromBudget(b);
    expect(
      buildBudgetUpdateBody({ ...base, amount: "500" }, b, "CHF").body,
    ).toEqual({ amountMinor: 50000 });
    expect(
      buildBudgetUpdateBody({ ...base, bookId: "" }, b, "CHF").body,
    ).toEqual({ bookId: null });
    expect(
      buildBudgetUpdateBody({ ...base, category: "" }, b, "CHF").body,
    ).toEqual({ category: null });
    expect(
      buildBudgetUpdateBody(
        { ...base, period: "year", active: false },
        b,
        "CHF",
      ).body,
    ).toEqual({ period: "year", active: false });
  });

  it("will not take both halves of the scope away", () => {
    const b = budget();
    const built = buildBudgetUpdateBody(
      { ...draftFromBudget(b), bookId: "", category: "" },
      b,
      "CHF",
    );
    expect(built.body).toBeUndefined();
    expect(built.errors).toHaveProperty("bookId");
  });

  it("reads the amount in the currency of the budget, not the household's", () => {
    const b = budget({ currency: "JPY", amountMinor: 5000 });
    const d = draftFromBudget(b);
    expect(d.amount).toBe("5000");
    expect(buildBudgetUpdateBody(d, b, "CHF").body).toEqual({});
  });
});

describe("why a budget could not be saved", () => {
  it("words a second budget for the same scope as such", () => {
    expect(budgetSaveErrors(new ApiError("conflict", "x"))).toEqual({
      bookId:
        "Für dieses Buch, diese Kategorie und diesen Zeitraum gibt es schon ein Budget.",
    });
  });

  it("words a missing scope that the server found", () => {
    const err = new ApiError("invalid_request", "x", {
      status: 400,
      details: { body: { fieldErrors: { bookId: ["x"] } } },
    });
    expect(budgetSaveErrors(err)?.bookId).toBe(
      "Wähle ein Buch, eine Kategorie oder beides.",
    );
  });

  it("leaves every other failure to the generic message", () => {
    expect(budgetSaveErrors(new ApiError("internal", "x"))).toBeUndefined();
    expect(budgetSaveErrors(new Error("x"))).toBeUndefined();
    expect(
      budgetSaveErrors(
        new ApiError("invalid_request", "x", {
          details: { body: { fieldErrors: { amountMinor: ["x"] } } },
        }),
      ),
    ).toBeUndefined();
  });
});
