import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { costBalances } from "./balances";
import { listCostBooks } from "./books";
import { createCost } from "./costs";
import { createSettlement } from "./settlements";

describe("the payments a view of one book leaves out", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;
  const pay = (over: Record<string, unknown>) =>
    createSettlement(
      ctx(),
      createSettlementRequestSchema.parse({ date: "2026-04-01", ...over }),
      null,
    );

  async function pair() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    return { anna, ben };
  }

  it("counts the payments across all books, in the household currency, for a single book", async () => {
    const { anna, ben } = await pair();
    pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 5_000 });
    pay({ fromUserId: anna.id, toUserId: ben.id, amountMinor: 1_250 });
    // another currency, and payments of a book, are not among them
    pay({
      fromUserId: ben.id,
      toUserId: anna.id,
      amountMinor: 9_999,
      currency: "EUR",
    });
    pay({
      fromUserId: ben.id,
      toUserId: anna.id,
      amountMinor: 700,
      bookId: book("Haushalt").id,
    });

    expect(
      costBalances(ctx(), { bookId: book("Haushalt").id }).crossBookSettlements,
    ).toEqual({ count: 2, totalMinor: 6_250 });
    expect(
      costBalances(ctx(), { bookId: book("Wohnung").id }).crossBookSettlements,
    ).toEqual({ count: 2, totalMinor: 6_250 });
  });

  it("is zero when there are none, and absent in the view of all books", async () => {
    const { anna, ben } = await pair();
    expect(
      costBalances(ctx(), { bookId: book("Auto").id }).crossBookSettlements,
    ).toEqual({ count: 0, totalMinor: 0 });
    pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 5_000 });
    expect(costBalances(ctx()).crossBookSettlements).toBeNull();
    expect(costBalances(ctx(), {}).crossBookSettlements).toBeNull();
  });

  it("does not change what the view of the book itself adds up", async () => {
    const { anna, ben } = await pair();
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 10_000,
        category: "groceries",
        bookId: book("Haushalt").id,
        paidByUserId: anna.id,
        splitMode: "equal",
      }),
      null,
    );
    pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 5_000 });
    const single = costBalances(ctx(), { bookId: book("Haushalt").id });
    // the payment across all books is not in the book's balances, only counted next to them
    expect(single.people.map((p) => p.balanceMinor)).toEqual([5_000, -5_000]);
    expect(single.crossBookSettlements).toEqual({
      count: 1,
      totalMinor: 5_000,
    });
    // across all books it is in the balances, and nothing is left out
    expect(costBalances(ctx()).people.map((p) => p.balanceMinor)).toEqual([
      0, 0,
    ]);
    expect(ben.id).toBeTruthy();
  });
});
