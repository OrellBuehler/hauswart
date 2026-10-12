import { describe, expect, it } from "vitest";
import { createSettlementRequestSchema } from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { settlements } from "$lib/server/db";
import { listCostBooks } from "./books";
import {
  deleteSettlement,
  recordSettlement,
  updateSettlement,
} from "./settlements";

describe("recording a payment twice", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const carl = await createTestUser({ displayName: "Carl" });
    return { anna, ben, carl };
  }
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;
  const record = (over: Record<string, unknown>, createdBy: string | null) =>
    recordSettlement(
      ctx(),
      createSettlementRequestSchema.parse({ amountMinor: 5_000, ...over }),
      createdBy,
    );
  const rows = () => test.db.select().from(settlements).all();
  const failure = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err as { code?: string };
    }
    return undefined;
  };
  const KEY = "retry-key-0001";

  it("returns the first payment for the same key and records nothing more", async () => {
    const { anna, ben } = await setup();
    const first = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    expect(first.replayed).toBe(false);
    const again = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    expect(again.replayed).toBe(true);
    expect(again.settlement).toEqual(first.settlement);
    expect(rows()).toHaveLength(1);
  });

  it("records every request that has no key", async () => {
    const { anna, ben } = await setup();
    const a = record({ fromUserId: ben.id, toUserId: anna.id }, anna.id);
    const b = record({ fromUserId: ben.id, toUserId: anna.id }, anna.id);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect(rows()).toHaveLength(2);
  });

  it("keeps the keys of two people apart", async () => {
    const { anna, ben, carl } = await setup();
    const byAnna = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    const byBen = record(
      { fromUserId: carl.id, toUserId: anna.id, idempotencyKey: KEY },
      ben.id,
    );
    expect(byBen.replayed).toBe(false);
    expect(byBen.settlement.id).not.toBe(byAnna.settlement.id);
    // and each sees only their own on a retry
    expect(
      record(
        { fromUserId: carl.id, toUserId: anna.id, idempotencyKey: KEY },
        ben.id,
      ).settlement.id,
    ).toBe(byBen.settlement.id);
    expect(rows()).toHaveLength(2);
  });

  it("refuses the same key for another payment and keeps the first", async () => {
    const { anna, ben, carl } = await setup();
    const first = record(
      {
        fromUserId: ben.id,
        toUserId: anna.id,
        idempotencyKey: KEY,
        bookId: book("Haushalt").id,
      },
      anna.id,
    );
    for (const other of [
      { amountMinor: 5_001 },
      { fromUserId: carl.id },
      { toUserId: carl.id },
      { currency: "EUR" },
      { bookId: null },
      { bookId: book("Auto").id },
    ]) {
      const err = failure(() =>
        record(
          {
            fromUserId: ben.id,
            toUserId: anna.id,
            idempotencyKey: KEY,
            bookId: book("Haushalt").id,
            ...other,
          },
          anna.id,
        ),
      );
      expect(err?.code).toBe("conflict");
    }
    expect(rows().map((r) => r.id)).toEqual([first.settlement.id]);
  });

  it("does not count the date and the note: a retry may differ in them", async () => {
    const { anna, ben } = await setup();
    const first = record(
      {
        fromUserId: ben.id,
        toUserId: anna.id,
        idempotencyKey: KEY,
        note: "Twint",
        date: "2026-06-01",
      },
      anna.id,
    );
    const again = record(
      {
        fromUserId: ben.id,
        toUserId: anna.id,
        idempotencyKey: KEY,
        date: "2026-06-02",
      },
      anna.id,
    );
    expect(again).toMatchObject({ replayed: true });
    expect(again.settlement).toMatchObject({
      id: first.settlement.id,
      note: "Twint",
      date: "2026-06-01",
    });
  });

  it("answers a retry with what the payment is now", async () => {
    const { anna, ben } = await setup();
    const first = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    updateSettlement(ctx(), first.settlement.id, { note: "später" });
    const again = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    expect(again.settlement.note).toBe("später");
  });

  it("frees the key once the payment is deleted", async () => {
    const { anna, ben } = await setup();
    const first = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    deleteSettlement(ctx(), first.settlement.id);
    const again = record(
      { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
      anna.id,
    );
    expect(again.replayed).toBe(false);
    expect(again.settlement.id).not.toBe(first.settlement.id);
  });

  it("checks a first request as before, and a refused request leaves the key unused", async () => {
    const { anna, ben } = await setup();
    const bad = failure(() =>
      record(
        { fromUserId: ben.id, toUserId: ben.id, idempotencyKey: KEY },
        anna.id,
      ),
    );
    expect(bad?.code).toBe("invalid_request");
    expect(rows()).toHaveLength(0);
    expect(
      record(
        { fromUserId: ben.id, toUserId: anna.id, idempotencyKey: KEY },
        anna.id,
      ).replayed,
    ).toBe(false);
  });

  it("takes keys of 8 to 128 characters", () => {
    const parse = (idempotencyKey: string) =>
      createSettlementRequestSchema.safeParse({
        fromUserId: "a",
        toUserId: "b",
        amountMinor: 100,
        idempotencyKey,
      }).success;
    expect(parse("1234567")).toBe(false);
    expect(parse("12345678")).toBe(true);
    expect(parse("x".repeat(128))).toBe(true);
    expect(parse("x".repeat(129))).toBe(false);
  });
});
