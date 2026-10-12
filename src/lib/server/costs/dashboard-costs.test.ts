import { describe, expect, it, vi } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { costBalances, dashboardBalances } from "./balances";
import { listCostBooks, updateCostBook } from "./books";
import { createCost } from "./costs";
import { createSettlement } from "./settlements";
import { costsSummary, costsYearToDate } from "./summary";

describe("the dashboard's cost numbers", () => {
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
        category: "repair",
        date: "2026-03-10",
        ...over,
      }),
      null,
    );
  const pay = (over: Record<string, unknown>) =>
    createSettlement(
      ctx(),
      createSettlementRequestSchema.parse({ date: "2026-04-01", ...over }),
      null,
    );

  async function trio() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const carl = await createTestUser({ displayName: "Carl" });
    return { anna, ben, carl };
  }

  describe("costsYearToDate", () => {
    it("adds up the same expenses as the year's summary, in total and per book", async () => {
      await trio();
      cost({ amountMinor: 50_000, category: "repair" });
      cost({ amountMinor: 20_000, category: "utilities" });
      cost({ amountMinor: -5_000, category: "repair" }); // a refund is netted off
      cost({ amountMinor: 30_000, category: "mortgage_principal" }); // equity, not an expense
      cost({ amountMinor: 9_000, currency: "EUR" }); // another currency
      cost({ amountMinor: 7_000, date: "2025-12-31" }); // another year
      cost({
        amountMinor: 12_000,
        category: "groceries",
        bookId: book("Haushalt").id,
      });
      cost({
        amountMinor: 3_000,
        category: "fuel",
        bookId: book("Auto").id,
      });

      const ytd = costsYearToDate(ctx());
      const summary = costsSummary(ctx(), 2026);
      expect(ytd.year).toBe(2026);
      expect(ytd.currency).toBe("CHF");
      expect(ytd.totalMinor).toBe(summary.expenseTotalMinor);
      expect(ytd.totalMinor).toBe(80_000);
      expect(ytd.byCategory).toEqual(summary.byCategory.slice(0, 3));
      expect(ytd.byBook).toEqual([
        {
          bookId: book("Wohnung").id,
          bookName: "Wohnung",
          taxRelevant: true,
          archived: false,
          totalMinor: 65_000,
          count: 3,
        },
        {
          bookId: book("Haushalt").id,
          bookName: "Haushalt",
          taxRelevant: false,
          archived: false,
          totalMinor: 12_000,
          count: 1,
        },
        {
          bookId: book("Auto").id,
          bookName: "Auto",
          taxRelevant: false,
          archived: false,
          totalMinor: 3_000,
          count: 1,
        },
      ]);
      // each book alone is what the summary of that book says
      for (const b of ytd.byBook) {
        expect(
          costsSummary(ctx(), 2026, { bookId: b.bookId }).expenseTotalMinor,
        ).toBe(b.totalMinor);
      }
      expect(ytd.byBook.reduce((n, b) => n + b.totalMinor, 0)).toBe(
        ytd.totalMinor,
      );
    });

    it("leaves out books without an expense this year, keeps archived ones that have one, and orders by amount then name", async () => {
      await trio();
      cost({ amountMinor: 5_000, bookId: book("Auto").id });
      cost({ amountMinor: 5_000, bookId: book("Haushalt").id });
      cost({
        amountMinor: 1_000,
        bookId: book("Wohnung").id,
        date: "2025-01-01",
      });
      updateCostBook(ctx(), book("Auto").id, { archived: true });
      const ytd = costsYearToDate(ctx());
      expect(ytd.byBook.map((b) => [b.bookName, b.archived])).toEqual([
        ["Auto", true],
        ["Haushalt", false],
      ]);
    });

    it("is empty without any cost", async () => {
      await trio();
      expect(costsYearToDate(ctx())).toEqual({
        year: 2026,
        currency: "CHF",
        totalMinor: 0,
        byCategory: [],
        byBook: [],
      });
    });

    it("has no settlement: who owes whom is the balances' business", async () => {
      const { anna } = await trio();
      cost({ amountMinor: 9_000, paidByUserId: anna.id, splitMode: "equal" });
      expect(costsYearToDate(ctx())).not.toHaveProperty("settlement");
    });
  });

  describe("dashboardBalances", () => {
    it("is the caller's balance across all books, with the first three payments of everybody's", async () => {
      const { anna, ben, carl } = await trio();
      cost({
        amountMinor: 9_000,
        paidByUserId: anna.id,
        splitMode: "equal",
        bookId: book("Haushalt").id,
      });
      const b = dashboardBalances(ctx(), ben.id);
      expect(b).toMatchObject({
        currency: "CHF",
        myBalanceMinor: -3_000,
        hasActivity: true,
        suggestedPaymentCount: 2,
      });
      // two people owe the same: which comes first is by id, so compare them by name
      expect(
        [...b.suggestedPayments].sort((x, y) =>
          (x.fromName ?? "").localeCompare(y.fromName ?? ""),
        ),
      ).toEqual([
        {
          fromUserId: ben.id,
          fromName: "Ben",
          toUserId: anna.id,
          toName: "Anna",
          amountMinor: 3_000,
        },
        {
          fromUserId: carl.id,
          fromName: "Carl",
          toUserId: anna.id,
          toName: "Anna",
          amountMinor: 3_000,
        },
      ]);
      expect(dashboardBalances(ctx(), anna.id).myBalanceMinor).toBe(6_000);
    });

    it("counts recorded payments, across all books included", async () => {
      const { anna, ben } = await trio();
      cost({
        amountMinor: 9_000,
        paidByUserId: anna.id,
        splitMode: "equal",
        bookId: book("Haushalt").id,
      });
      pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 3_000 });
      expect(dashboardBalances(ctx(), ben.id).myBalanceMinor).toBe(0);
      expect(dashboardBalances(ctx(), anna.id).myBalanceMinor).toBe(3_000);
    });

    it("says nothing happened yet, and then that everybody is square", async () => {
      const { anna, ben } = await trio();
      expect(dashboardBalances(ctx(), anna.id)).toMatchObject({
        myBalanceMinor: 0,
        hasActivity: false,
        suggestedPayments: [],
        suggestedPaymentCount: 0,
      });
      cost({ amountMinor: 6_000, paidByUserId: anna.id, splitMode: "none" });
      // not split: nobody's business
      expect(dashboardBalances(ctx(), anna.id).hasActivity).toBe(false);
      pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 100 });
      pay({ fromUserId: anna.id, toUserId: ben.id, amountMinor: 100 });
      expect(dashboardBalances(ctx(), anna.id)).toMatchObject({
        myBalanceMinor: 0,
        hasActivity: true,
        suggestedPayments: [],
      });
    });

    it("cuts the payments to three and says how many there are", async () => {
      const people = [];
      for (const name of ["A", "B", "C", "D", "E", "F"]) {
        people.push(await createTestUser({ displayName: name }));
      }
      // one pays for everything, five owe a share: five payments
      cost({
        amountMinor: 60_000,
        paidByUserId: people[0].id,
        splitMode: "equal",
        bookId: book("Haushalt").id,
      });
      const b = dashboardBalances(ctx(), people[1].id);
      expect(b.suggestedPayments).toHaveLength(3);
      expect(b.suggestedPaymentCount).toBe(5);
      expect(b.suggestedPayments).toEqual(
        costBalances(ctx()).suggestedPayments.slice(0, 3),
      );
    });

    it("leaves out another currency, like the balance page", async () => {
      const { anna } = await trio();
      cost({
        amountMinor: 9_000,
        currency: "EUR",
        paidByUserId: anna.id,
        splitMode: "equal",
      });
      expect(dashboardBalances(ctx(), anna.id)).toMatchObject({
        myBalanceMinor: 0,
        hasActivity: false,
      });
    });

    it("reads the ledger once, however many entries there are", async () => {
      const { anna } = await trio();
      const queries = () => {
        const spy = vi.spyOn(test.db.$client, "prepare");
        dashboardBalances(ctx(), anna.id);
        const n = spy.mock.calls.length;
        spy.mockRestore();
        return n;
      };
      const few = queries();
      expect(few).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) {
        cost({
          amountMinor: 1_000 + i,
          paidByUserId: anna.id,
          splitMode: "equal",
          bookId: book(i % 2 ? "Haushalt" : "Auto").id,
        });
      }
      const many = queries();
      expect(many).toBe(few);
      expect(few).toBeLessThanOrEqual(6);
    });
  });
});
