import { describe, expect, it } from "vitest";
import {
  createSettlementRequestSchema,
  updateSettlementRequestSchema,
} from "$lib/api/schemas/settlements";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { listCostBooks, updateCostBook } from "./books";
import {
  createSettlement,
  deleteSettlement,
  getSettlement,
  listSettlements,
  updateSettlement,
} from "./settlements";

describe("settlements service", () => {
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
  const record = (
    over: Record<string, unknown>,
    createdBy: string | null = null,
  ) =>
    createSettlement(
      ctx(),
      createSettlementRequestSchema.parse({ amountMinor: 5000, ...over }),
      createdBy,
    );
  const errorCode = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return (err as { code?: string }).code;
    }
    return undefined;
  };

  describe("create", () => {
    it("records a payment with today's date and the household currency", async () => {
      const { anna, ben } = await setup();
      const s = record({ fromUserId: ben.id, toUserId: anna.id }, anna.id);
      expect(s).toMatchObject({
        bookId: null,
        bookName: null,
        fromUserId: ben.id,
        fromName: "Ben",
        toUserId: anna.id,
        toName: "Anna",
        amountMinor: 5000,
        currency: "CHF",
        date: "2026-06-15",
        note: null,
        createdBy: anna.id,
      });
    });

    it("takes the date, currency, note and book it is given", async () => {
      const { anna, ben } = await setup();
      const s = record({
        fromUserId: ben.id,
        toUserId: anna.id,
        amountMinor: 12345,
        currency: "EUR",
        date: "2026-02-01",
        note: " Twint ",
        bookId: book("Haushalt").id,
      });
      expect(s).toMatchObject({
        amountMinor: 12345,
        currency: "EUR",
        date: "2026-02-01",
        note: "Twint",
        bookName: "Haushalt",
      });
    });

    it("may name an archived book: closing a trip and paying back later is the normal order", async () => {
      const { anna, ben } = await setup();
      updateCostBook(ctx(), book("Auto").id, { archived: true });
      expect(
        record({
          fromUserId: ben.id,
          toUserId: anna.id,
          bookId: book("Auto").id,
        }).bookName,
      ).toBe("Auto");
    });

    it("refuses what is not a payment between two members, in a book that exists", async () => {
      const { anna, ben } = await setup();
      expect(
        errorCode(() => record({ fromUserId: anna.id, toUserId: anna.id })),
      ).toBe("invalid_request");
      expect(
        errorCode(() => record({ fromUserId: "missing", toUserId: anna.id })),
      ).toBe("invalid_request");
      expect(
        errorCode(() => record({ fromUserId: anna.id, toUserId: "missing" })),
      ).toBe("invalid_request");
      expect(
        errorCode(() =>
          record({ fromUserId: ben.id, toUserId: anna.id, bookId: "missing" }),
        ),
      ).toBe("invalid_request");
    });

    it.each([0, -1, 1.5, 1e12])("rejects the amount %s", (amountMinor) => {
      expect(
        createSettlementRequestSchema.safeParse({
          fromUserId: "a",
          toUserId: "b",
          amountMinor,
        }).success,
      ).toBe(false);
    });

    it("rejects unknown fields and a bad currency", () => {
      const base = { fromUserId: "a", toUserId: "b", amountMinor: 100 };
      expect(
        createSettlementRequestSchema.safeParse({ ...base, extra: 1 }).success,
      ).toBe(false);
      expect(
        createSettlementRequestSchema.safeParse({ ...base, currency: "chf" })
          .success,
      ).toBe(false);
      expect(
        createSettlementRequestSchema.safeParse({ ...base, date: "2026-02-30" })
          .success,
      ).toBe(false);
    });
  });

  describe("update", () => {
    it("changes what is given and nothing else", async () => {
      const { anna, ben, carl } = await setup();
      const s = record({
        fromUserId: ben.id,
        toUserId: anna.id,
        bookId: book("Haushalt").id,
        note: "alt",
      });
      const next = updateSettlement(
        ctx(),
        s.id,
        updateSettlementRequestSchema.parse({
          amountMinor: 700,
          toUserId: carl.id,
          bookId: null,
          note: null,
          date: "2026-05-05",
        }),
      );
      expect(next).toMatchObject({
        amountMinor: 700,
        toUserId: carl.id,
        toName: "Carl",
        fromUserId: ben.id,
        bookId: null,
        bookName: null,
        note: null,
        date: "2026-05-05",
        currency: "CHF",
      });
    });

    it("checks the two people together", async () => {
      const { anna, ben } = await setup();
      const s = record({ fromUserId: ben.id, toUserId: anna.id });
      expect(
        errorCode(() =>
          updateSettlement(
            ctx(),
            s.id,
            updateSettlementRequestSchema.parse({ fromUserId: anna.id }),
          ),
        ),
      ).toBe("invalid_request");
      expect(
        errorCode(() =>
          updateSettlement(
            ctx(),
            s.id,
            updateSettlementRequestSchema.parse({ bookId: "missing" }),
          ),
        ),
      ).toBe("invalid_request");
      expect(getSettlement(ctx(), s.id).fromUserId).toBe(ben.id);
    });

    it("404s for an unknown payment", () => {
      expect(
        errorCode(() => updateSettlement(ctx(), "missing", { amountMinor: 5 })),
      ).toBe("not_found");
    });
  });

  describe("delete", () => {
    it("removes the payment, once", async () => {
      const { anna, ben } = await setup();
      const s = record({ fromUserId: ben.id, toUserId: anna.id });
      deleteSettlement(ctx(), s.id);
      expect(errorCode(() => getSettlement(ctx(), s.id))).toBe("not_found");
      expect(errorCode(() => deleteSettlement(ctx(), s.id))).toBe("not_found");
    });
  });

  describe("list", () => {
    async function seed() {
      const { anna, ben, carl } = await setup();
      record({
        fromUserId: ben.id,
        toUserId: anna.id,
        date: "2026-01-10",
        note: "eins",
      });
      record({
        fromUserId: carl.id,
        toUserId: anna.id,
        date: "2026-02-10",
        bookId: book("Haushalt").id,
        note: "zwei",
      });
      record({
        fromUserId: anna.id,
        toUserId: ben.id,
        date: "2025-12-10",
        note: "drei",
      });
      record({
        fromUserId: carl.id,
        toUserId: ben.id,
        date: "2026-02-10",
        note: "vier",
      });
      return { anna, ben, carl };
    }
    const notes = (
      filter: Parameters<typeof listSettlements>[1] = {},
      page: { cursor?: string; limit: number } = { limit: 50 },
      viewer = "x",
    ) => listSettlements(ctx(), filter, page, viewer).items.map((s) => s.note);

    it("lists newest first, then in the order entered", async () => {
      await seed();
      expect(notes()).toEqual(["vier", "zwei", "eins", "drei"]);
    });

    it("filters by book, year, range and person", async () => {
      const { anna, carl } = await seed();
      expect(notes({ bookId: book("Haushalt").id })).toEqual(["zwei"]);
      expect(notes({ bookId: book("Wohnung").id })).toEqual([]);
      expect(notes({ year: 2025 })).toEqual(["drei"]);
      expect(notes({ from: "2026-01-10", to: "2026-02-09" })).toEqual(["eins"]);
      expect(notes({ userId: carl.id })).toEqual(["vier", "zwei"]);
      expect(notes({ userId: "me" }, { limit: 50 }, anna.id)).toEqual([
        "zwei",
        "eins",
        "drei",
      ]);
    });

    it("404s for a book that does not exist, instead of an empty list", async () => {
      await seed();
      expect(errorCode(() => notes({ bookId: "missing" }))).toBe("not_found");
      // A book that exists but has no payments, or is archived, is an empty list.
      updateCostBook(ctx(), book("Auto").id, { archived: true });
      expect(notes({ bookId: book("Auto").id })).toEqual([]);
    });

    it("pages with a cursor without skipping or repeating", async () => {
      await seed();
      const seen: (string | null)[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = listSettlements(ctx(), {}, { limit: 1, cursor }, "x");
        seen.push(...page.items.map((s) => s.note));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(notes());
    });

    it("rejects a forged cursor", async () => {
      await seed();
      expect(errorCode(() => notes({}, { limit: 5, cursor: "garbage" }))).toBe(
        "invalid_request",
      );
    });
  });
});
