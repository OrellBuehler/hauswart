import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createAsset } from "$lib/server/assets/assets";
import { costEntries, costEntryShares } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { listCostBooks } from "./books";
import { deleteCost, getCost, recordCost, updateCost } from "./costs";

describe("booking a cost twice", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const KEY = "retry-key-0001";

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    return { anna, ben };
  }
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;
  const record = (over: Record<string, unknown>, createdBy: string | null) =>
    recordCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 2_340,
        category: "groceries",
        date: "2026-06-10",
        ...over,
      }),
      createdBy,
    );
  const rows = () => test.db.select().from(costEntries).all();
  const failure = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err as { code?: string };
    }
    return undefined;
  };

  it("returns the first entry for the same key and books nothing more", async () => {
    const { anna } = await setup();
    const first = record({ idempotencyKey: KEY }, anna.id);
    expect(first.replayed).toBe(false);
    const again = record({ idempotencyKey: KEY }, anna.id);
    expect(again.replayed).toBe(true);
    expect(again.cost).toEqual(first.cost);
    expect(rows()).toHaveLength(1);
    expect(test.db.select().from(costEntryShares).all()).toHaveLength(2);
  });

  it("books every request that has no key", async () => {
    const { anna } = await setup();
    const a = record({}, anna.id);
    const b = record({}, anna.id);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect(rows()).toHaveLength(2);
  });

  it("does not look at keys when nobody books (no person to keep them apart)", () => {
    const a = record({ idempotencyKey: KEY }, null);
    const b = record({ idempotencyKey: KEY }, null);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect(rows()).toHaveLength(2);
  });

  it("keeps the keys of two people apart", async () => {
    const { anna, ben } = await setup();
    const byAnna = record({ idempotencyKey: KEY }, anna.id);
    const byBen = record({ idempotencyKey: KEY }, ben.id);
    expect(byBen.replayed).toBe(false);
    expect(byBen.cost.id).not.toBe(byAnna.cost.id);
    expect(record({ idempotencyKey: KEY }, ben.id).cost.id).toBe(byBen.cost.id);
    expect(rows()).toHaveLength(2);
  });

  it("refuses the same key for another entry and keeps the first", async () => {
    const { anna, ben } = await setup();
    const first = record(
      {
        idempotencyKey: KEY,
        bookId: book("Haushalt").id,
        paidByUserId: anna.id,
      },
      anna.id,
    );
    for (const other of [
      { amountMinor: 2_341 },
      { currency: "EUR" },
      { category: "dining" },
      { title: "Anderer Einkauf" },
      { date: "2026-06-11" },
      { bookId: book("Auto").id },
      { paidByUserId: ben.id },
    ]) {
      const err = failure(() =>
        record(
          {
            idempotencyKey: KEY,
            bookId: book("Haushalt").id,
            paidByUserId: anna.id,
            ...other,
          },
          anna.id,
        ),
      );
      expect([other, err?.code]).toEqual([other, "conflict"]);
    }
    expect(rows().map((r) => r.id)).toEqual([first.cost.id]);
  });

  it("takes a retry that leaves out what the first request left to the defaults, and does not count notes, payee or device", async () => {
    const { anna } = await setup();
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    const first = record(
      {
        idempotencyKey: KEY,
        notes: "Wocheneinkauf",
        payee: "Beispiel AG",
        assetId: asset.id,
      },
      anna.id,
    );
    const again = record(
      { idempotencyKey: KEY, date: undefined, notes: "später ergänzt" },
      anna.id,
    );
    expect(again.replayed).toBe(true);
    expect(again.cost).toMatchObject({
      id: first.cost.id,
      notes: "Wocheneinkauf",
      payee: "Beispiel AG",
      assetId: asset.id,
    });
    expect(rows()).toHaveLength(1);
  });

  it("answers a retry with what the entry is now", async () => {
    const { anna } = await setup();
    const first = record({ idempotencyKey: KEY }, anna.id);
    updateCost(ctx(), first.cost.id, { notes: "nachträglich" });
    const again = record({ idempotencyKey: KEY }, anna.id);
    expect(again.cost.notes).toBe("nachträglich");
  });

  it("frees the key once the entry is deleted", async () => {
    const { anna } = await setup();
    const first = record({ idempotencyKey: KEY }, anna.id);
    deleteCost(ctx(), first.cost.id);
    const again = record({ idempotencyKey: KEY }, anna.id);
    expect(again.replayed).toBe(false);
    expect(again.cost.id).not.toBe(first.cost.id);
    expect(getCost(ctx(), again.cost.id).title).toBe("Einkauf");
  });

  it("checks a first request as before, and a refused request leaves the key unused", async () => {
    const { anna } = await setup();
    const bad = failure(() =>
      record({ idempotencyKey: KEY, assetId: "nobody" }, anna.id),
    );
    expect(bad?.code).toBe("invalid_request");
    expect(rows()).toHaveLength(0);
    expect(record({ idempotencyKey: KEY }, anna.id).replayed).toBe(false);
  });

  it("takes keys of 8 to 128 characters", () => {
    const parse = (idempotencyKey: string) =>
      createCostRequestSchema.safeParse({
        title: "Einkauf",
        amountMinor: 100,
        category: "groceries",
        idempotencyKey,
      }).success;
    expect(parse("1234567")).toBe(false);
    expect(parse("12345678")).toBe(true);
    expect(parse("x".repeat(128))).toBe(true);
    expect(parse("x".repeat(129))).toBe(false);
  });
});
