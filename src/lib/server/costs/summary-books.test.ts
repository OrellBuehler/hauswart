import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { listCostBooks, updateCostBook } from "./books";
import { createCost } from "./costs";
import { createSettlement } from "./settlements";
import { costsSummary, costsYearToDate } from "./summary";

describe("the year summary and books", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;
  const cost = (over: Record<string, unknown>) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Eintrag",
        amountMinor: 1000,
        category: "repair",
        date: "2026-03-10",
        splitMode: "equal",
        ...over,
      }),
      null,
    );

  async function household() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    return { anna, ben };
  }

  it("can be limited to one book: totals, categories, months and settlement are that book's alone", async () => {
    const { anna, ben } = await household();
    cost({
      amountMinor: 8000,
      category: "repair",
      paidByUserId: anna.id,
      bookId: book("Wohnung").id,
    });
    cost({
      amountMinor: 3000,
      category: "groceries",
      date: "2026-05-02",
      paidByUserId: ben.id,
      bookId: book("Haushalt").id,
    });
    cost({
      amountMinor: 1000,
      category: "groceries",
      date: "2026-05-03",
      paidByUserId: ben.id,
      bookId: book("Haushalt").id,
    });

    const all = costsSummary(ctx(), 2026);
    expect(all.expenseTotalMinor).toBe(12_000);
    const haushalt = costsSummary(ctx(), 2026, { bookId: book("Haushalt").id });
    expect(haushalt).toMatchObject({
      expenseTotalMinor: 4000,
      byCategory: [{ category: "groceries", totalMinor: 4000, count: 2 }],
    });
    expect(haushalt.byMonth[4]).toMatchObject({
      month: "2026-05",
      totalMinor: 4000,
      count: 2,
    });
    expect(haushalt.settlement).toEqual([
      expect.objectContaining({
        fromName: "Anna",
        toName: "Ben",
        amountMinor: 2000,
      }),
    ]);
    const wohnung = costsSummary(ctx(), 2026, { bookId: book("Wohnung").id });
    expect(wohnung.expenseTotalMinor).toBe(8000);
    expect(wohnung.settlement).toEqual([
      expect.objectContaining({
        fromName: "Ben",
        toName: "Anna",
        amountMinor: 4000,
      }),
    ]);
    expect(
      costsSummary(ctx(), 2026, { bookId: book("Auto").id }).expenseTotalMinor,
    ).toBe(0);
    // a book that does not exist is not an empty book
    expect(() => costsSummary(ctx(), 2026, { bookId: "unknown" })).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });

  it("combines the book with an asset filter", async () => {
    await household();
    cost({ amountMinor: 500, bookId: book("Wohnung").id });
    expect(
      costsSummary(ctx(), 2026, {
        bookId: book("Wohnung").id,
        assetId: "unknown",
      }).expenseTotalMinor,
    ).toBe(0);
  });

  it("counts the tax classes of tax relevant books only", async () => {
    await household();
    cost({ amountMinor: 5000, deductible: "maintenance" });
    cost({ amountMinor: 700, bookId: book("Haushalt").id });
    cost({ amountMinor: 900, bookId: book("Auto").id });
    const s = costsSummary(ctx(), 2026);
    expect(s.expenseTotalMinor).toBe(6600);
    expect(s.byDeductible).toEqual([
      { deductible: "maintenance", totalMinor: 5000, count: 1 },
    ]);
    expect(
      costsSummary(ctx(), 2026, { bookId: book("Haushalt").id }).byDeductible,
    ).toEqual([]);
    updateCostBook(ctx(), book("Haushalt").id, { taxRelevant: true });
    expect(
      costsSummary(ctx(), 2026, { bookId: book("Haushalt").id }).byDeductible,
    ).toEqual([{ deductible: "unknown", totalMinor: 700, count: 1 }]);
  });

  it("does not count recorded payments: a payment is not a cost and the year settlement is entries only", async () => {
    const { anna, ben } = await household();
    cost({ amountMinor: 10_000, paidByUserId: anna.id });
    const before = costsSummary(ctx(), 2026);
    createSettlement(
      ctx(),
      createSettlementRequestSchema.parse({
        fromUserId: ben.id,
        toUserId: anna.id,
        amountMinor: 5000,
        date: "2026-03-11",
      }),
      null,
    );
    expect(costsSummary(ctx(), 2026)).toEqual(before);
    expect(before.expenseTotalMinor).toBe(10_000);
  });

  it("keeps the dashboard's slice across all books", async () => {
    const { anna } = await household();
    cost({ amountMinor: 4000, paidByUserId: anna.id });
    cost({
      amountMinor: 1000,
      category: "groceries",
      paidByUserId: anna.id,
      bookId: book("Haushalt").id,
    });
    const ytd = costsYearToDate({ db: test.db, now: ctx().now });
    expect(ytd).toMatchObject({ year: 2026, totalMinor: 5000 });
    expect(ytd.byCategory.map((c) => c.category)).toEqual([
      "repair",
      "groceries",
    ]);
  });
});
