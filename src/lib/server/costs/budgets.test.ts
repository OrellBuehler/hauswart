import { describe, expect, it } from "vitest";
import {
  createCostBudgetRequestSchema,
  updateCostBudgetRequestSchema,
  type CreateCostBudgetRequest,
} from "$lib/api/schemas/cost-budgets";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { costBudgets } from "$lib/server/db";
import { at, ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCostBook,
  defaultCostBook,
  deleteCostBook,
  listCostBooks,
} from "./books";
import {
  costBudgetStatus,
  createCostBudget,
  deleteCostBudget,
  getCostBudget,
  listCostBudgets,
  updateCostBudget,
} from "./budgets";
import { createCost } from "./costs";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";

describe("cost budgets", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;

  const budget = (over: Record<string, unknown> = {}) =>
    createCostBudget(
      ctx(),
      createCostBudgetRequestSchema.parse({
        category: "groceries",
        period: "month",
        amountMinor: 50000,
        ...over,
      }),
    );
  const cost = (over: Record<string, unknown> = {}) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 1000,
        category: "groceries",
        date: "2026-06-10",
        splitMode: "none",
        ...over,
      }),
      null,
    );
  const status = (query = {}, now?: number) =>
    costBudgetStatus(ctx(now), query);
  const only = (query = {}, now?: number) => status(query, now).items[0]!;

  describe("the budgets", () => {
    it("makes a budget in the household currency, active, for a category, a book or both", () => {
      const b = budget();
      expect(b).toMatchObject({
        category: "groceries",
        bookId: null,
        bookName: null,
        period: "month",
        amountMinor: 50000,
        currency: "CHF",
        active: true,
      });
      const haushalt = book("Haushalt");
      expect(budget({ category: null, bookId: haushalt.id })).toMatchObject({
        bookId: haushalt.id,
        bookName: "Haushalt",
        category: null,
      });
      expect(budget({ bookId: haushalt.id, category: "dining" })).toMatchObject(
        { bookId: haushalt.id, category: "dining" },
      );
    });

    it("needs a book or a category, and a book that exists", () => {
      expect(
        createCostBudgetRequestSchema.safeParse({
          category: null,
          period: "month",
          amountMinor: 1,
        }).success,
      ).toBe(false);
      expect(() =>
        createCostBudget(ctx(), {
          period: "month",
          amountMinor: 1,
        } as CreateCostBudgetRequest),
      ).toThrow("Invalid request");
      expect(() => budget({ bookId: "nope" })).toThrow("Invalid request");
      expect(() => budget({ category: null, bookId: "nope" })).toThrow(
        "Invalid request",
      );
    });

    it("allows one budget per book, category and period", () => {
      const haushalt = book("Haushalt");
      budget();
      expect(() => budget()).toThrow(/budget for this book/);
      budget({ period: "year" });
      budget({ category: "dining" });
      budget({ category: null, bookId: haushalt.id });
      expect(() => budget({ category: null, bookId: haushalt.id })).toThrow(
        /budget for this book/,
      );
      budget({ bookId: haushalt.id });
      expect(() => budget({ bookId: haushalt.id })).toThrow(
        /budget for this book/,
      );
      budget({ bookId: haushalt.id, category: "dining" });
      expect(listCostBudgets(ctx())).toHaveLength(6);
    });

    it("lists the budgets in the order they were made", () => {
      const names = ["dining", "groceries", "travel"] as const;
      for (const category of names) budget({ category });
      expect(listCostBudgets(ctx()).map((b) => b.category)).toEqual([...names]);
    });

    it("changes the amount, the period, the scope and the switch", () => {
      const b = budget();
      expect(
        updateCostBudget(
          ctx(),
          b.id,
          updateCostBudgetRequestSchema.parse({
            amountMinor: 60000,
            period: "year",
            active: false,
          }),
        ),
      ).toMatchObject({ amountMinor: 60000, period: "year", active: false });
      const haushalt = book("Haushalt");
      expect(
        updateCostBudget(
          ctx(),
          b.id,
          updateCostBudgetRequestSchema.parse({ bookId: haushalt.id }),
        ),
      ).toMatchObject({ bookId: haushalt.id, category: "groceries" });
      expect(
        updateCostBudget(
          ctx(),
          b.id,
          updateCostBudgetRequestSchema.parse({ category: null }),
        ),
      ).toMatchObject({ bookId: haushalt.id, category: null });
    });

    it("refuses a change that leaves no book and no category, a missing book and a clash with another budget", () => {
      const b = budget();
      expect(() =>
        updateCostBudget(
          ctx(),
          b.id,
          updateCostBudgetRequestSchema.parse({ category: null }),
        ),
      ).toThrow("Invalid request");
      expect(() =>
        updateCostBudget(
          ctx(),
          b.id,
          updateCostBudgetRequestSchema.parse({ bookId: "nope" }),
        ),
      ).toThrow("Invalid request");
      const year = budget({ period: "year" });
      expect(() =>
        updateCostBudget(
          ctx(),
          year.id,
          updateCostBudgetRequestSchema.parse({ period: "month" }),
        ),
      ).toThrow(/budget for this book/);
      expect(getCostBudget(ctx(), year.id).period).toBe("year");
    });

    it("answers not found for a budget that is not there", () => {
      expect(() => getCostBudget(ctx(), "nope")).toThrow(/not found/);
      expect(() =>
        updateCostBudget(
          ctx(),
          "nope",
          updateCostBudgetRequestSchema.parse({ active: true }),
        ),
      ).toThrow(/not found/);
      expect(() => deleteCostBudget(ctx(), "nope")).toThrow(/not found/);
    });

    it("deletes a budget, and goes with an empty book that is deleted", () => {
      const b = budget();
      deleteCostBudget(ctx(), b.id);
      expect(listCostBudgets(ctx())).toEqual([]);
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      budget({ category: null, bookId: ferien.id });
      budget({ category: "travel" });
      deleteCostBook(ctx(), ferien.id);
      expect(listCostBudgets(ctx()).map((x) => x.category)).toEqual(["travel"]);
    });
  });

  describe("the status", () => {
    it("adds up the expense entries of a category in the month", () => {
      budget();
      cost({ amountMinor: 12000, date: "2026-06-01" });
      cost({ amountMinor: 8000, date: "2026-06-30" });
      cost({ amountMinor: 99999, date: "2026-05-31" });
      cost({ amountMinor: 99999, date: "2026-07-01" });
      cost({ amountMinor: 5000, category: "dining" });
      expect(only({ year: 2026, month: 6 })).toMatchObject({
        periodFrom: "2026-06-01",
        periodTo: "2026-06-30",
        spentMinor: 20000,
        entryCount: 2,
        remainingMinor: 30000,
        percentUsed: 40,
        state: "ok",
      });
    });

    it("nets refunds off and leaves a negative total at zero percent", () => {
      budget();
      cost({ amountMinor: 10000 });
      cost({ amountMinor: -2500, title: "Rückgabe" });
      expect(only({ year: 2026, month: 6 })).toMatchObject({
        spentMinor: 7500,
        percentUsed: 15,
        entryCount: 2,
      });
      cost({ amountMinor: -20000, title: "Gutschrift" });
      expect(only({ year: 2026, month: 6 })).toMatchObject({
        spentMinor: -12500,
        remainingMinor: 62500,
        percentUsed: 0,
        state: "ok",
      });
    });

    it("leaves out what does not count as an expense, and entries in another currency", () => {
      budget({ category: "mortgage_principal" });
      budget({ category: "groceries", period: "year" });
      cost({ category: "mortgage_principal", amountMinor: 100000 });
      cost({ amountMinor: 3000 });
      cost({ amountMinor: 70000, currency: "EUR" });
      cost({ amountMinor: 4000, countsAsExpense: false });
      const [principal, groceries] = status({ year: 2026, month: 6 }).items;
      expect(principal).toMatchObject({ spentMinor: 0, entryCount: 0 });
      expect(groceries).toMatchObject({ spentMinor: 3000, entryCount: 1 });
    });

    it("counts a budget in its own currency against entries in that currency", () => {
      budget();
      test.db.update(costBudgets).set({ currency: "EUR" }).run();
      cost({ amountMinor: 700 });
      cost({ amountMinor: 300, currency: "EUR" });
      expect(only({ year: 2026, month: 6 })).toMatchObject({
        spentMinor: 300,
        budget: { currency: "EUR" },
      });
      expect(status().currency).toBe("CHF");
    });

    it("measures a yearly budget over the whole year whatever month is asked", () => {
      budget({ period: "year", amountMinor: 100000 });
      cost({ amountMinor: 10000, date: "2026-01-01" });
      cost({ amountMinor: 20000, date: "2026-12-31" });
      cost({ amountMinor: 40000, date: "2025-12-31" });
      for (const month of [1, 6, 12]) {
        expect(only({ year: 2026, month })).toMatchObject({
          periodFrom: "2026-01-01",
          periodTo: "2026-12-31",
          spentMinor: 30000,
        });
      }
    });

    it("scopes a budget by book, by category, or by both", () => {
      const haushalt = book("Haushalt");
      const wohnung = defaultCostBook(ctx());
      budget({ category: null, bookId: haushalt.id });
      budget({ category: "groceries", bookId: haushalt.id });
      budget({ category: "groceries" });
      cost({ amountMinor: 1000, bookId: haushalt.id });
      cost({ amountMinor: 2000, bookId: haushalt.id, category: "dining" });
      cost({ amountMinor: 4000, bookId: wohnung.id });
      const [inBook, inBookAndCategory, inCategory] = status({
        year: 2026,
        month: 6,
      }).items;
      expect(inBook).toMatchObject({ spentMinor: 3000, entryCount: 2 });
      expect(inBookAndCategory).toMatchObject({
        spentMinor: 1000,
        entryCount: 1,
      });
      expect(inCategory).toMatchObject({ spentMinor: 5000, entryCount: 2 });
    });

    it("leaves inactive budgets out", () => {
      const b = budget();
      budget({ category: "dining" });
      updateCostBudget(
        ctx(),
        b.id,
        updateCostBudgetRequestSchema.parse({ active: false }),
      );
      expect(status().items.map((i) => i.budget.category)).toEqual(["dining"]);
    });

    it.each<[string, number, number, string]>([
      ["79 percent", 39500, 79, "ok"],
      ["79.99 percent", 39999, 79, "ok"],
      ["exactly 80 percent", 40000, 80, "warning"],
      ["99.99 percent", 49999, 99, "warning"],
      ["exactly the amount", 50000, 100, "exceeded"],
      ["a third more", 66667, 133, "exceeded"],
    ])("reports %s", (_name, spent, percent, state) => {
      budget();
      cost({ amountMinor: spent });
      expect(only({ year: 2026, month: 6 })).toMatchObject({
        spentMinor: spent,
        percentUsed: percent,
        state,
        remainingMinor: 50000 - spent,
      });
    });

    it("measures the current month of the household zone by default", () => {
      budget();
      cost({ amountMinor: 1000, date: "2026-03-31" });
      cost({ amountMinor: 2000, date: "2026-04-01" });
      // 23:30 on 31 March in Zurich is already 21:30 UTC; 00:30 on 1 April is 22:30 UTC the day before.
      const march = status({}, at("2026-03-31", "23:30"));
      expect(march).toMatchObject({ year: 2026, month: 3 });
      expect(march.items[0]).toMatchObject({ spentMinor: 1000 });
      const april = status({}, at("2026-04-01", "00:30"));
      expect(april).toMatchObject({ year: 2026, month: 4 });
      expect(april.items[0]).toMatchObject({ spentMinor: 2000 });
    });

    it("takes the year and the month from the query independently", () => {
      budget();
      cost({ amountMinor: 1000, date: "2025-02-10" });
      expect(only({ year: 2025, month: 2 })).toMatchObject({
        spentMinor: 1000,
      });
      expect(only({ year: 2025, month: 3 })).toMatchObject({ spentMinor: 0 });
      expect(status({ year: 2025 }).month).toBe(6);
      expect(status({ month: 2 }).year).toBe(2026);
    });

    it("measures February by its real length", () => {
      budget();
      cost({ amountMinor: 100, date: "2028-02-29" });
      cost({ amountMinor: 200, date: "2028-03-01" });
      expect(only({ year: 2028, month: 2 })).toMatchObject({
        periodTo: "2028-02-29",
        spentMinor: 100,
      });
    });

    it("answers an empty list without budgets", () => {
      expect(status()).toMatchObject({
        items: [],
        currency: "CHF",
        warningPercent: 80,
      });
    });
  });
});
