import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createAsset } from "$lib/server/assets/assets";
import { users } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { createCost } from "./costs";
import { costsSummary, costsYearToDate, settle } from "./summary";

describe("settle", () => {
  it("pays the largest creditor from the largest debtor", () => {
    expect(
      settle([
        { userId: "a", balanceMinor: 700 },
        { userId: "b", balanceMinor: -700 },
      ]),
    ).toEqual([{ fromUserId: "b", toUserId: "a", amountMinor: 700 }]);
  });

  it("settles three people with the fewest payments it can find greedily", () => {
    const transfers = settle([
      { userId: "a", balanceMinor: 500 },
      { userId: "b", balanceMinor: -300 },
      { userId: "c", balanceMinor: -200 },
    ]);
    expect(transfers).toEqual([
      { fromUserId: "b", toUserId: "a", amountMinor: 300 },
      { fromUserId: "c", toUserId: "a", amountMinor: 200 },
    ]);
    const net = new Map<string, number>();
    for (const t of transfers) {
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amountMinor);
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amountMinor);
    }
    expect([...net]).toEqual([
      ["b", -300],
      ["a", 500],
      ["c", -200],
    ]);
  });

  it("splits a debt over several creditors", () => {
    expect(
      settle([
        { userId: "a", balanceMinor: 400 },
        { userId: "b", balanceMinor: 100 },
        { userId: "c", balanceMinor: -500 },
      ]),
    ).toEqual([
      { fromUserId: "c", toUserId: "a", amountMinor: 400 },
      { fromUserId: "c", toUserId: "b", amountMinor: 100 },
    ]);
  });

  it("is empty when everything is square", () => {
    expect(settle([])).toEqual([]);
    expect(
      settle([
        { userId: "a", balanceMinor: 0 },
        { userId: "b", balanceMinor: 0 },
      ]),
    ).toEqual([]);
  });

  it("is deterministic on ties", () => {
    const a = settle([
      { userId: "b", balanceMinor: -100 },
      { userId: "a", balanceMinor: -100 },
      { userId: "d", balanceMinor: 100 },
      { userId: "c", balanceMinor: 100 },
    ]);
    const b = settle([
      { userId: "c", balanceMinor: 100 },
      { userId: "d", balanceMinor: 100 },
      { userId: "a", balanceMinor: -100 },
      { userId: "b", balanceMinor: -100 },
    ]);
    expect(b).toEqual(a);
  });
});

describe("costsSummary", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const book = (
    over: Record<string, unknown>,
    createdBy: string | null = null,
  ) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Eintrag",
        amountMinor: 1000,
        category: "repair",
        date: "2026-03-10",
        ...over,
      }),
      createdBy,
    );

  async function household(ownership: [number, number] = [5000, 5000]) {
    const a = await createTestUser({ displayName: "Anna", username: "anna" });
    const b = await createTestUser({ displayName: "Ben", username: "ben" });
    test.db
      .update(users)
      .set({ ownershipBps: ownership[0] })
      .where(eq(users.id, a.id))
      .run();
    test.db
      .update(users)
      .set({ ownershipBps: ownership[1] })
      .where(eq(users.id, b.id))
      .run();
    return { a, b };
  }

  it("is empty but complete for a year without entries", async () => {
    const { a, b } = await household();
    const s = costsSummary(ctx(), 2026);
    expect(s).toMatchObject({
      year: 2026,
      currency: "CHF",
      expenseTotalMinor: 0,
      equityTotalMinor: 0,
      otherCurrencyCount: 0,
      byCategory: [],
      byAsset: [],
      byDeductible: [],
      settlement: [],
      unassignedPayerCount: 0,
    });
    expect(s.byMonth.map((m) => m.month)).toEqual(
      Array.from(
        { length: 12 },
        (_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(s.people.map((p) => [p.userName, p.balanceMinor])).toEqual([
      ["Anna", 0],
      ["Ben", 0],
    ]);
    expect([a.id, b.id]).toBeTruthy();
  });

  it("totals per category, month, asset and tax class from expenses only", async () => {
    await household();
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ kind: "device", name: "Waschmaschine" }),
    );
    const other = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ kind: "device", name: "Herd" }),
    );
    book({
      amountMinor: 30000,
      category: "repair",
      assetId: asset.id,
      deductible: "maintenance",
    });
    book({
      amountMinor: 5000,
      category: "repair",
      assetId: asset.id,
      date: "2026-04-02",
      deductible: "maintenance",
    });
    book({
      amountMinor: -2000,
      category: "repair",
      assetId: asset.id,
      date: "2026-04-20",
    });
    book({
      amountMinor: 80000,
      category: "renovation",
      assetId: other.id,
      date: "2026-11-30",
      deductible: "investment",
    });
    book({
      amountMinor: 120000,
      category: "mortgage_principal",
      date: "2026-06-30",
    });
    book({ amountMinor: 999, category: "utilities", date: "2025-12-31" });
    book({ amountMinor: 777, category: "utilities", date: "2027-01-01" });
    const s = costsSummary(ctx(), 2026);
    expect(s.expenseTotalMinor).toBe(30000 + 5000 - 2000 + 80000);
    expect(s.equityTotalMinor).toBe(120000);
    expect(s.byCategory).toEqual([
      { category: "renovation", totalMinor: 80000, count: 1 },
      { category: "repair", totalMinor: 33000, count: 3 },
    ]);
    expect(s.byMonth[2]).toEqual({
      month: "2026-03",
      totalMinor: 30000,
      count: 1,
    });
    expect(s.byMonth[3]).toEqual({
      month: "2026-04",
      totalMinor: 3000,
      count: 2,
    });
    expect(s.byMonth[10]).toEqual({
      month: "2026-11",
      totalMinor: 80000,
      count: 1,
    });
    expect(s.byMonth[5].totalMinor).toBe(0);
    expect(s.byAsset).toEqual([
      { assetId: other.id, assetName: "Herd", totalMinor: 80000, count: 1 },
      {
        assetId: asset.id,
        assetName: "Waschmaschine",
        totalMinor: 33000,
        count: 3,
      },
    ]);
    expect(s.byDeductible).toEqual([
      { deductible: "unknown", totalMinor: -2000, count: 1 },
      { deductible: "maintenance", totalMinor: 35000, count: 2 },
      { deductible: "investment", totalMinor: 80000, count: 1 },
    ]);
  });

  it("keeps only the ten assets with the highest costs", async () => {
    await household();
    for (let i = 1; i <= 12; i++) {
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({
          kind: "device",
          name: `Gerät ${String(i).padStart(2, "0")}`,
        }),
      );
      book({ amountMinor: i * 100, assetId: asset.id });
    }
    const s = costsSummary(ctx(), 2026);
    expect(s.byAsset).toHaveLength(10);
    expect(s.byAsset[0].assetName).toBe("Gerät 12");
    expect(s.byAsset[9].assetName).toBe("Gerät 03");
  });

  it("leaves other currencies out of every total and counts them", async () => {
    await household();
    book({ amountMinor: 1000 });
    book({ amountMinor: 55555, currency: "EUR" });
    const s = costsSummary(ctx(), 2026);
    expect(s.expenseTotalMinor).toBe(1000);
    expect(s.otherCurrencyCount).toBe(1);
  });

  describe("settlement", () => {
    it("Anna paid 100.00 for a 50/50 cost: Ben owes her 50.00", async () => {
      const { a, b } = await household();
      book({ amountMinor: 10000, paidByUserId: a.id });
      const s = costsSummary(ctx(), 2026);
      expect(s.people).toEqual([
        {
          userId: a.id,
          userName: "Anna",
          paidMinor: 10000,
          shareMinor: 5000,
          balanceMinor: 5000,
        },
        {
          userId: b.id,
          userName: "Ben",
          paidMinor: 0,
          shareMinor: 5000,
          balanceMinor: -5000,
        },
      ]);
      expect(s.settlement).toEqual([
        {
          fromUserId: b.id,
          fromName: "Ben",
          toUserId: a.id,
          toName: "Anna",
          amountMinor: 5000,
        },
      ]);
    });

    it("nets what both paid and follows the ownership shares", async () => {
      const { a, b } = await household([7000, 3000]);
      book({ amountMinor: 20000, paidByUserId: a.id });
      book({ amountMinor: 10000, paidByUserId: b.id });
      // total 300.00: Anna bears 210.00, Ben 90.00; Anna paid 200.00, Ben 100.00
      const s = costsSummary(ctx(), 2026);
      const by = Object.fromEntries(s.people.map((p) => [p.userName, p]));
      expect(by.Anna).toMatchObject({
        paidMinor: 20000,
        shareMinor: 21000,
        balanceMinor: -1000,
      });
      expect(by.Ben).toMatchObject({
        paidMinor: 10000,
        shareMinor: 9000,
        balanceMinor: 1000,
      });
      expect(s.settlement).toEqual([
        {
          fromUserId: a.id,
          fromName: "Anna",
          toUserId: b.id,
          toName: "Ben",
          amountMinor: 1000,
        },
      ]);
    });

    it("balances add up to exactly zero even with awkward amounts", async () => {
      const { a, b } = await household([3333, 6667]);
      for (const amount of [1, 7, 101, 99999, -333]) {
        book({ amountMinor: amount, paidByUserId: amount % 2 ? a.id : b.id });
      }
      const s = costsSummary(ctx(), 2026);
      expect(s.people.reduce((x, p) => x + p.balanceMinor, 0)).toBe(0);
      expect(s.people.reduce((x, p) => x + p.paidMinor, 0)).toBe(
        s.people.reduce((x, p) => x + p.shareMinor, 0),
      );
    });

    it("includes equity entries (cash paid) but not unsplit ones", async () => {
      const { a } = await household();
      book({
        amountMinor: 100000,
        category: "mortgage_principal",
        paidByUserId: a.id,
      });
      book({ amountMinor: 4000, splitMode: "none", paidByUserId: a.id });
      const s = costsSummary(ctx(), 2026);
      expect(s.expenseTotalMinor).toBe(4000);
      expect(s.equityTotalMinor).toBe(100000);
      expect(s.people.find((p) => p.userId === a.id)).toMatchObject({
        paidMinor: 100000,
        balanceMinor: 50000,
      });
    });

    it("reports split entries without a payer instead of guessing", async () => {
      const { a } = await household();
      book({ amountMinor: 4000 });
      book({ amountMinor: 1000, paidByUserId: a.id });
      const s = costsSummary(ctx(), 2026);
      expect(s.unassignedPayerCount).toBe(1);
      expect(s.people.find((p) => p.userId === a.id)?.paidMinor).toBe(1000);
    });

    it("handles custom shares and a refund", async () => {
      const { a, b } = await household();
      book({
        amountMinor: 10000,
        paidByUserId: a.id,
        splitMode: "custom",
        shares: [
          { userId: a.id, shareBps: 2000 },
          { userId: b.id, shareBps: 8000 },
        ],
      });
      book({
        amountMinor: -1000,
        paidByUserId: a.id,
        splitMode: "custom",
        shares: [
          { userId: a.id, shareBps: 2000 },
          { userId: b.id, shareBps: 8000 },
        ],
      });
      const s = costsSummary(ctx(), 2026);
      expect(s.settlement).toEqual([
        {
          fromUserId: b.id,
          fromName: "Ben",
          toUserId: a.id,
          toName: "Anna",
          amountMinor: 7200,
        },
      ]);
    });
  });

  it("year to date for the dashboard: top three categories and the settlement", async () => {
    const { a } = await household();
    book({ amountMinor: 5000, category: "repair", paidByUserId: a.id });
    book({ amountMinor: 4000, category: "utilities" });
    book({ amountMinor: 3000, category: "insurance" });
    book({ amountMinor: 2000, category: "taxes_fees" });
    book({ amountMinor: 1000, category: "other", date: "2025-06-01" });
    const d = costsYearToDate(ctx());
    expect(d.year).toBe(2026);
    expect(d.totalMinor).toBe(14000);
    expect(d.byCategory.map((c) => c.category)).toEqual([
      "repair",
      "utilities",
      "insurance",
    ]);
    expect(d.settlement).toHaveLength(1);
  });
});
