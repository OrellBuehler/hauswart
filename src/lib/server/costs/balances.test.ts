import { describe, expect, it } from "vitest";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { costBalances } from "./balances";
import { createCostBook, listCostBooks, updateCostBook } from "./books";
import { createCost, deleteCost } from "./costs";
import { createSettlement, deleteSettlement } from "./settlements";
import { costsSummary } from "./summary";

describe("balances", () => {
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
        title: "Einkauf",
        category: "groceries",
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
  const balances = (bookId?: string) => costBalances(ctx(), { bookId });
  const byName = (b: ReturnType<typeof costBalances>) =>
    Object.fromEntries(b.people.map((p) => [p.userName, p.balanceMinor]));
  const payments = (b: ReturnType<typeof costBalances>) =>
    b.suggestedPayments
      .map((t) => `${t.fromName}>${t.toName}:${t.amountMinor}`)
      .sort();

  async function trio() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const carl = await createTestUser({ displayName: "Carl" });
    return { anna, ben, carl };
  }
  async function pair() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    return { anna, ben };
  }

  it("is square when nothing was booked", async () => {
    await pair();
    const b = balances();
    expect(b).toMatchObject({
      book: null,
      currency: "CHF",
      otherCurrencyCount: 0,
      unassignedPayerCount: 0,
      suggestedPayments: [],
    });
    expect(b.people).toHaveLength(2);
    expect(b.people.every((p) => p.balanceMinor === 0)).toBe(true);
  });

  it("says who owes whom: paid minus share", async () => {
    const { anna, ben } = await pair();
    cost({
      amountMinor: 10000,
      splitMode: "equal",
      paidByUserId: anna.id,
      bookId: book("Haushalt").id,
    });
    const b = balances();
    expect(b.people).toEqual([
      {
        userId: anna.id,
        userName: "Anna",
        paidMinor: 10000,
        shareMinor: 5000,
        sentMinor: 0,
        receivedMinor: 0,
        balanceMinor: 5000,
      },
      {
        userId: ben.id,
        userName: "Ben",
        paidMinor: 0,
        shareMinor: 5000,
        sentMinor: 0,
        receivedMinor: 0,
        balanceMinor: -5000,
      },
    ]);
    expect(payments(b)).toEqual(["Ben>Anna:5000"]);
    expect(b.suggestedPayments[0]).toMatchObject({
      fromUserId: ben.id,
      toUserId: anna.id,
    });
  });

  it("moves the balances with a payment, and squares them with the full one", async () => {
    const { anna, ben } = await pair();
    cost({ amountMinor: 10000, splitMode: "equal", paidByUserId: anna.id });
    const settlement = pay({
      fromUserId: ben.id,
      toUserId: anna.id,
      amountMinor: 3000,
    });
    const part = balances();
    expect(byName(part)).toEqual({ Anna: 2000, Ben: -2000 });
    expect(part.people.find((p) => p.userId === ben.id)).toMatchObject({
      sentMinor: 3000,
      receivedMinor: 0,
    });
    expect(part.people.find((p) => p.userId === anna.id)).toMatchObject({
      sentMinor: 0,
      receivedMinor: 3000,
    });
    expect(payments(part)).toEqual(["Ben>Anna:2000"]);

    pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 2000 });
    const square = balances();
    expect(byName(square)).toEqual({ Anna: 0, Ben: 0 });
    expect(square.suggestedPayments).toEqual([]);

    deleteSettlement(ctx(), settlement.id);
    expect(byName(balances())).toEqual({ Anna: 3000, Ben: -3000 });
  });

  it("turns around when somebody pays too much", async () => {
    const { anna, ben } = await pair();
    cost({ amountMinor: 10000, splitMode: "equal", paidByUserId: anna.id });
    pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 6000 });
    const b = balances();
    expect(byName(b)).toEqual({ Anna: -1000, Ben: 1000 });
    expect(payments(b)).toEqual(["Anna>Ben:1000"]);
  });

  it("counts a payment the other way round as a debt, not a repayment", async () => {
    const { anna, ben } = await pair();
    pay({ fromUserId: anna.id, toUserId: ben.id, amountMinor: 2500 });
    expect(byName(balances())).toEqual({ Anna: 2500, Ben: -2500 });
  });

  it("splits among the participants only", async () => {
    const { anna, ben, carl } = await trio();
    cost({
      amountMinor: 9000,
      splitMode: "equal",
      participantIds: [ben.id, carl.id],
      paidByUserId: anna.id,
    });
    const b = balances();
    expect(byName(b)).toEqual({ Anna: 9000, Ben: -4500, Carl: -4500 });
    expect(payments(b)).toEqual(["Ben>Anna:4500", "Carl>Anna:4500"]);
  });

  it("ignores entries that are not split, and counts a refund against the expense", async () => {
    const { anna, ben } = await pair();
    cost({ amountMinor: 8000, splitMode: "none", paidByUserId: anna.id });
    expect(byName(balances())).toEqual({ Anna: 0, Ben: 0 });
    cost({ amountMinor: 10000, splitMode: "equal", paidByUserId: anna.id });
    cost({ amountMinor: -4000, splitMode: "equal", paidByUserId: anna.id });
    expect(byName(balances())).toEqual({ Anna: 3000, Ben: -3000 });
    expect(ben.id).toBeTruthy();
  });

  it("counts a split entry without a payer, but cannot settle it", async () => {
    await pair();
    cost({ amountMinor: 5000, splitMode: "equal" });
    const b = balances();
    expect(b.unassignedPayerCount).toBe(1);
    expect(b.people.every((p) => p.balanceMinor === 0)).toBe(true);
  });

  it("covers all time, every year", async () => {
    const { anna } = await pair();
    for (const date of ["2024-05-01", "2025-05-01", "2026-05-01"]) {
      cost({
        date,
        amountMinor: 1000,
        splitMode: "equal",
        paidByUserId: anna.id,
      });
    }
    expect(byName(balances())).toEqual({ Anna: 1500, Ben: -1500 });
  });

  it("leaves other currencies out and says how many", async () => {
    const { anna, ben } = await pair();
    cost({ amountMinor: 1000, splitMode: "equal", paidByUserId: anna.id });
    cost({
      amountMinor: 99900,
      currency: "EUR",
      splitMode: "equal",
      paidByUserId: anna.id,
    });
    pay({
      fromUserId: ben.id,
      toUserId: anna.id,
      amountMinor: 700,
      currency: "EUR",
    });
    const b = balances();
    expect(b.otherCurrencyCount).toBe(2);
    expect(byName(b)).toEqual({ Anna: 500, Ben: -500 });
  });

  describe("by book", () => {
    async function setup() {
      const { anna, ben } = await pair();
      const haushalt = book("Haushalt").id;
      const wohnung = book("Wohnung").id;
      cost({
        amountMinor: 10000,
        splitMode: "equal",
        paidByUserId: anna.id,
        bookId: haushalt,
      });
      cost({
        amountMinor: 4000,
        splitMode: "equal",
        paidByUserId: ben.id,
        bookId: wohnung,
      });
      return { anna, ben, haushalt, wohnung };
    }

    it("is the book's alone, and the sum of the books is all of them", async () => {
      const { haushalt, wohnung } = await setup();
      const h = balances(haushalt);
      expect(h.book).toEqual({ id: haushalt, name: "Haushalt" });
      expect(byName(h)).toEqual({ Anna: 5000, Ben: -5000 });
      expect(byName(balances(wohnung))).toEqual({ Anna: -2000, Ben: 2000 });
      expect(byName(balances())).toEqual({ Anna: 3000, Ben: -3000 });
      expect(payments(balances())).toEqual(["Ben>Anna:3000"]);
    });

    it("takes the payments of its book, and those across all books only in the whole", async () => {
      const { anna, ben, haushalt, wohnung } = await setup();
      pay({
        fromUserId: ben.id,
        toUserId: anna.id,
        amountMinor: 1000,
        bookId: haushalt,
      });
      pay({ fromUserId: ben.id, toUserId: anna.id, amountMinor: 500 });
      expect(byName(balances(haushalt))).toEqual({ Anna: 4000, Ben: -4000 });
      expect(byName(balances(wohnung))).toEqual({ Anna: -2000, Ben: 2000 });
      expect(byName(balances())).toEqual({ Anna: 1500, Ben: -1500 });
    });

    it("keeps an archived book in the whole, and in its own", async () => {
      const { haushalt } = await setup();
      updateCostBook(ctx(), haushalt, { archived: true });
      expect(byName(balances())).toEqual({ Anna: 3000, Ben: -3000 });
      expect(byName(balances(haushalt))).toEqual({ Anna: 5000, Ben: -5000 });
    });

    it("is square for a book without entries, and 404s for one that does not exist", async () => {
      await setup();
      const auto = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      expect(byName(balances(auto.id))).toEqual({ Anna: 0, Ben: 0 });
      expect(() => balances("missing")).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("moves an entry's balance with it when it changes book", async () => {
      const { anna, haushalt } = await setup();
      const moved = cost({
        amountMinor: 2000,
        splitMode: "equal",
        paidByUserId: anna.id,
        bookId: haushalt,
      });
      expect(byName(balances(haushalt))).toEqual({ Anna: 6000, Ben: -6000 });
      deleteCost(ctx(), moved.id);
      expect(byName(balances(haushalt))).toEqual({ Anna: 5000, Ben: -5000 });
    });
  });

  describe("invariants", () => {
    /** A small deterministic generator: the same entries every run. */
    function rng(seed: number) {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
      };
    }

    it("add up to zero, whatever the split, and the suggestions square them in fewer payments than people", async () => {
      const { anna, ben, carl } = await trio();
      const dave = await createTestUser({ displayName: "Dave" });
      const members = [anna, ben, carl, dave];
      const next = rng(7);
      const books = [book("Wohnung").id, book("Haushalt").id, book("Auto").id];
      for (let i = 0; i < 60; i++) {
        const payer = members[Math.floor(next() * members.length)];
        const kind = Math.floor(next() * 4);
        const participants = members
          .filter(() => next() < 0.6)
          .map((m) => m.id);
        cost({
          amountMinor:
            (Math.floor(next() * 50000) + 1) * (next() < 0.1 ? -1 : 1),
          paidByUserId: payer.id,
          bookId: books[Math.floor(next() * books.length)],
          ...(kind === 0
            ? { splitMode: "ownership" }
            : kind === 1
              ? { splitMode: "equal" }
              : kind === 2 && participants.length > 0
                ? { splitMode: "equal", participantIds: participants }
                : { splitMode: "none" }),
        });
        if (next() < 0.2) {
          const from = members[Math.floor(next() * members.length)];
          const to = members.find((m) => m.id !== from.id)!;
          pay({
            fromUserId: from.id,
            toUserId: to.id,
            amountMinor: Math.floor(next() * 20000) + 1,
          });
        }
      }
      for (const scope of [undefined, ...books]) {
        const b = balances(scope);
        expect(
          b.people.reduce((sum, p) => sum + p.balanceMinor, 0),
          String(scope),
        ).toBe(0);
        const owed = b.people
          .filter((p) => p.balanceMinor > 0)
          .reduce((sum, p) => sum + p.balanceMinor, 0);
        expect(b.suggestedPayments.reduce((s, t) => s + t.amountMinor, 0)).toBe(
          owed,
        );
        expect(b.suggestedPayments.length).toBeLessThan(members.length);
        // paying the suggestions leaves everybody square
        const square = new Map(b.people.map((p) => [p.userId, p.balanceMinor]));
        for (const t of b.suggestedPayments) {
          square.set(
            t.fromUserId,
            (square.get(t.fromUserId) ?? 0) + t.amountMinor,
          );
          square.set(t.toUserId, (square.get(t.toUserId) ?? 0) - t.amountMinor);
        }
        expect([...square.values()].every((v) => v === 0)).toBe(true);
      }
    });

    it("agree with the year summary where no payment was made", async () => {
      const { anna, ben, carl } = await trio();
      cost({
        amountMinor: 10001,
        splitMode: "equal",
        paidByUserId: anna.id,
      });
      cost({
        amountMinor: 777,
        splitMode: "equal",
        participantIds: [ben.id, carl.id],
        paidByUserId: carl.id,
      });
      cost({ amountMinor: 3333, paidByUserId: ben.id });
      const summary = costsSummary(ctx(), 2026);
      const b = balances();
      expect(
        b.people.map((p) => [
          p.userId,
          p.paidMinor,
          p.shareMinor,
          p.balanceMinor,
        ]),
      ).toEqual(
        summary.people.map((p) => [
          p.userId,
          p.paidMinor,
          p.shareMinor,
          p.balanceMinor,
        ]),
      );
      expect(b.suggestedPayments).toEqual(summary.settlement);
    });
  });
});
