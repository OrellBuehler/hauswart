import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createAsset } from "$lib/server/assets/assets";
import { costEntries } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { createCostBook } from "./books";
import {
  countReviewNeeded,
  createCost,
  flagForReview,
  getCost,
  listCosts,
  reviewCost,
} from "./costs";
import { costsSummary } from "./summary";

describe("cost entries to review", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const cost = (over: Record<string, unknown> = {}) =>
      createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Einkauf",
          amountMinor: 2_340,
          category: "groceries",
          date: "2026-06-10",
          ...over,
        }),
        anna.id,
      );
    return { anna, ben, cost };
  }

  it("starts unflagged: a new entry needs no review", async () => {
    const { cost } = await world();
    expect(cost()).toMatchObject({
      reviewNeeded: false,
      reviewedAt: null,
      reviewedByUserId: null,
    });
    expect(countReviewNeeded(ctx())).toBe(0);
  });

  describe("flagForReview", () => {
    it("flags the entries named, ignores ids nobody has and forgets an earlier review", async () => {
      const { anna, cost } = await world();
      const a = cost();
      const b = cost({ title: "Zweiter" });
      const untouched = cost({ title: "Dritter" });
      reviewCost(ctx(), a.id, anna.id);
      flagForReview(ctx(), [a.id]);
      flagForReview(ctx(), [b.id, "missing"]);
      expect(getCost(ctx(), a.id)).toMatchObject({
        reviewNeeded: true,
        reviewedAt: null,
        reviewedByUserId: null,
      });
      expect(getCost(ctx(), b.id).reviewNeeded).toBe(true);
      expect(getCost(ctx(), untouched.id).reviewNeeded).toBe(false);
      expect(countReviewNeeded(ctx())).toBe(2);
    });

    it("does nothing for an empty list", async () => {
      const { cost } = await world();
      const a = cost();
      flagForReview(ctx(), []);
      expect(getCost(ctx(), a.id).reviewNeeded).toBe(false);
    });
  });

  describe("reviewCost", () => {
    it("clears the flag and records who looked and when", async () => {
      const { anna, ben, cost } = await world();
      const a = cost();
      flagForReview(ctx(), [a.id]);
      const later = NOW + 3_600_000;
      const reviewed = reviewCost(ctx(later), a.id, ben.id);
      expect(reviewed).toMatchObject({
        reviewNeeded: false,
        reviewedByUserId: ben.id,
      });
      expect(reviewed.reviewedAt?.getTime()).toBe(later);
      expect(reviewed.createdBy).toBe(anna.id);
    });

    it("changes nothing when nobody has to review it, and the first reviewer stays", async () => {
      const { anna, ben, cost } = await world();
      const a = cost();
      expect(reviewCost(ctx(), a.id, ben.id)).toMatchObject({
        reviewNeeded: false,
        reviewedAt: null,
        reviewedByUserId: null,
      });
      flagForReview(ctx(), [a.id]);
      const first = reviewCost(ctx(NOW + 1_000), a.id, anna.id);
      const again = reviewCost(ctx(NOW + 9_000), a.id, ben.id);
      expect(again.reviewedByUserId).toBe(anna.id);
      expect(again.reviewedAt?.getTime()).toBe(first.reviewedAt?.getTime());
    });

    it("is a 404 for an entry that does not exist", async () => {
      const { anna } = await world();
      expect(() => reviewCost(ctx(), "missing", anna.id)).toThrowError(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("leaves everything else of the entry alone", async () => {
      const { ben, cost } = await world();
      const a = cost({ title: "Beleg", notes: "Notiz", payee: "Laden" });
      flagForReview(ctx(), [a.id]);
      const before = getCost(ctx(), a.id);
      const after = reviewCost(ctx(), a.id, ben.id);
      expect({
        ...after,
        reviewNeeded: before.reviewNeeded,
        reviewedAt: before.reviewedAt,
        reviewedByUserId: before.reviewedByUserId,
        updatedAt: before.updatedAt,
      }).toEqual(before);
    });
  });

  it("lists only the entries to review, or only the others", async () => {
    const { cost } = await world();
    const a = cost({ title: "A" });
    const b = cost({ title: "B" });
    const c = cost({ title: "C" });
    flagForReview(ctx(), [a.id, c.id]);
    const titles = (reviewNeeded?: boolean) =>
      listCosts(ctx(), { reviewNeeded }, { limit: 50 }, "me")
        .items.map((e) => e.title)
        .sort();
    expect(titles()).toEqual(["A", "B", "C"]);
    expect(titles(true)).toEqual(["A", "C"]);
    expect(titles(false)).toEqual(["B"]);
    expect(b.reviewNeeded).toBe(false);
  });

  describe("the summary's count", () => {
    it("counts the entries of the year in any currency, whether or not they count as an expense", async () => {
      const { cost } = await world();
      const chf = cost();
      const eur = cost({ currency: "EUR", title: "Euro" });
      const equity = cost({
        category: "mortgage_principal",
        title: "Tilgung",
      });
      const lastYear = cost({ date: "2025-12-30", title: "Alt" });
      const fine = cost({ title: "In Ordnung" });
      flagForReview(ctx(), [chf.id, eur.id, equity.id, lastYear.id]);
      const summary = costsSummary(ctx(), 2026);
      expect(summary.reviewNeededCount).toBe(3);
      expect(costsSummary(ctx(), 2025).reviewNeededCount).toBe(1);
      expect(costsSummary(ctx(), 2024).reviewNeededCount).toBe(0);
      expect(getCost(ctx(), fine.id).reviewNeeded).toBe(false);
    });

    it("follows the asset or the book of the summary", async () => {
      const { cost } = await world();
      const car = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Auto", kind: "vehicle" }),
      );
      const trip = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Reise" }),
      );
      const onCar = cost({ assetId: car.id });
      const inTrip = cost({ bookId: trip.id });
      const plain = cost();
      flagForReview(ctx(), [onCar.id, inTrip.id, plain.id]);
      expect(costsSummary(ctx(), 2026).reviewNeededCount).toBe(3);
      expect(
        costsSummary(ctx(), 2026, { assetId: car.id }).reviewNeededCount,
      ).toBe(1);
      expect(
        costsSummary(ctx(), 2026, { bookId: trip.id }).reviewNeededCount,
      ).toBe(1);
    });
  });

  it("counts for the dashboard across years and books", async () => {
    const { cost } = await world();
    const a = cost({ date: "2024-02-02" });
    const b = cost();
    flagForReview(ctx(), [a.id, b.id]);
    expect(countReviewNeeded(ctx())).toBe(2);
    test.db
      .update(costEntries)
      .set({ reviewNeeded: false })
      .where(eq(costEntries.id, a.id))
      .run();
    expect(countReviewNeeded(ctx())).toBe(1);
  });
});
