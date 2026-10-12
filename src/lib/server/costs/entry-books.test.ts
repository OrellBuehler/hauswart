import { describe, expect, it } from "vitest";
import { COST_CATEGORIES } from "$lib/api/enums";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import {
  createCostRequestSchema,
  updateCostRequestSchema,
} from "$lib/api/schemas/costs";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCostBook,
  listCostBooks,
  updateCostBook,
  type CostBookRow,
} from "./books";
import { createCost, listCosts, updateCost } from "./costs";

type Create = Record<string, unknown>;

describe("cost entries and books", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const book = (name: string): CostBookRow => {
    const found = listCostBooks(
      ctx(),
      { includeArchived: true },
      { limit: 50 },
    ).items.find((b) => b.name === name);
    if (!found) throw new Error(`no book ${name}`);
    return found;
  };
  const newBook = (over: Create = {}) =>
    createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "Ferien", ...over }),
    );
  const entry = (over: Create = {}) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 10000,
        category: "groceries",
        date: "2026-03-10",
        ...over,
      }),
      null,
    );
  const patch = (id: string, over: Create) =>
    updateCost(ctx(), id, updateCostRequestSchema.parse(over));
  const archive = (name: string) =>
    updateCostBook(ctx(), book(name).id, { archived: true });
  const bps = (c: ReturnType<typeof entry>) =>
    Object.fromEntries(c.shares.map((s) => [s.userId, s.shareBps]));
  const parts = (c: ReturnType<typeof entry>) =>
    Object.fromEntries(c.shares.map((s) => [s.userId, s.amountMinor]));

  async function people(n: number) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(await createTestUser({ displayName: `Person ${i + 1}` }));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  describe("which book", () => {
    it("books into the default book, Wohnung, and splits it by ownership like before", async () => {
      await people(2);
      const c = entry();
      expect(c).toMatchObject({
        bookId: book("Wohnung").id,
        bookName: "Wohnung",
        splitMode: "ownership",
      });
    });

    it("takes the book it is told, and its default split", async () => {
      await people(3);
      const haushalt = entry({ bookId: book("Haushalt").id });
      expect(haushalt).toMatchObject({
        bookId: book("Haushalt").id,
        bookName: "Haushalt",
        splitMode: "equal",
      });
      expect(haushalt.shares).toHaveLength(3);
      const none = entry({ bookId: newBook({ defaultSplitMode: "none" }).id });
      expect(none.splitMode).toBe("none");
      expect(none.shares).toEqual([]);
    });

    it("lets the request override the split of the book", async () => {
      await people(2);
      expect(
        entry({ bookId: book("Haushalt").id, splitMode: "ownership" })
          .splitMode,
      ).toBe("ownership");
      expect(
        entry({ bookId: book("Haushalt").id, splitMode: "none" }).shares,
      ).toEqual([]);
    });

    it("goes to the next book once the first is archived", async () => {
      await people(2);
      archive("Wohnung");
      expect(entry().bookName).toBe("Haushalt");
    });

    it("refuses a book that does not exist or is archived", async () => {
      await people(2);
      newBook();
      archive("Ferien");
      for (const bookId of ["missing", book("Ferien").id]) {
        expect(() => entry({ bookId })).toThrowError(
          expect.objectContaining({
            code: "invalid_request",
            details: expect.objectContaining({
              body: expect.objectContaining({
                fieldErrors: { bookId: [expect.any(String)] },
              }),
            }),
          }),
        );
      }
    });

    it("filters the list by book", async () => {
      await people(2);
      entry({ title: "Wohnung eins" });
      entry({ title: "Haushalt eins", bookId: book("Haushalt").id });
      entry({ title: "Haushalt zwei", bookId: book("Haushalt").id });
      const titles = (bookId?: string) =>
        listCosts(ctx(), { bookId }, { limit: 50 }, "x")
          .items.map((c) => c.title)
          .sort();
      expect(titles(book("Haushalt").id)).toEqual([
        "Haushalt eins",
        "Haushalt zwei",
      ]);
      expect(titles(book("Wohnung").id)).toEqual(["Wohnung eins"]);
      expect(titles(book("Auto").id)).toEqual([]);
      expect(titles()).toHaveLength(3);
    });
  });

  describe("categories", () => {
    it("has the everyday ones, which count as an expense", async () => {
      await people(2);
      const everyday = [
        "groceries",
        "household",
        "dining",
        "leisure",
        "travel",
        "health",
        "gifts",
        "transport",
        "subscriptions",
        "fuel",
      ] as const;
      for (const category of everyday) {
        expect(COST_CATEGORIES).toContain(category);
        expect(entry({ category }).countsAsExpense, category).toBe(true);
      }
      expect(entry({ category: "mortgage_principal" }).countsAsExpense).toBe(
        false,
      );
    });
  });

  describe("tax class", () => {
    it("is for books that are tax relevant", async () => {
      await people(2);
      expect(entry({ deductible: "maintenance" }).deductible).toBe(
        "maintenance",
      );
      const haushalt = book("Haushalt").id;
      expect(entry({ bookId: haushalt }).deductible).toBe("unknown");
      expect(
        entry({ bookId: haushalt, deductible: "unknown" }).deductible,
      ).toBe("unknown");
      for (const deductible of ["maintenance", "investment", "no"]) {
        expect(() => entry({ bookId: haushalt, deductible })).toThrowError(
          expect.objectContaining({
            code: "invalid_request",
            details: expect.objectContaining({
              body: expect.objectContaining({
                fieldErrors: { deductible: [expect.any(String)] },
              }),
            }),
          }),
        );
      }
    });

    it("starts over when an entry moves to a book without one, and stays when it moves back", async () => {
      await people(2);
      const c = entry({ deductible: "investment" });
      const moved = patch(c.id, { bookId: book("Haushalt").id });
      expect(moved).toMatchObject({
        bookName: "Haushalt",
        deductible: "unknown",
      });
      expect(patch(c.id, { bookId: book("Wohnung").id }).deductible).toBe(
        "unknown",
      );
      expect(patch(c.id, { deductible: "maintenance" }).deductible).toBe(
        "maintenance",
      );
    });

    it("lets a move say the class, and refuses one for a book without classes", async () => {
      await people(2);
      const c = entry({ deductible: "investment" });
      expect(() =>
        patch(c.id, { bookId: book("Haushalt").id, deductible: "no" }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      expect(
        patch(c.id, { bookId: book("Haushalt").id, deductible: "unknown" })
          .deductible,
      ).toBe("unknown");
      const inHaushalt = entry({ bookId: book("Haushalt").id });
      expect(() => patch(inHaushalt.id, { deductible: "no" })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
    });

    it("keeps what entries say when their book stops being tax relevant, and accepts it back", async () => {
      await people(2);
      const c = entry({ deductible: "maintenance" });
      updateCostBook(ctx(), book("Wohnung").id, { taxRelevant: false });
      expect(patch(c.id, { title: "Anders" }).deductible).toBe("maintenance");
      expect(patch(c.id, { deductible: "maintenance" }).deductible).toBe(
        "maintenance",
      );
      expect(patch(c.id, { deductible: "unknown" }).deductible).toBe("unknown");
      expect(() => patch(c.id, { deductible: "investment" })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
    });
  });

  describe("moving between books", () => {
    it("moves an entry, keeping its shares", async () => {
      await people(2);
      const c = entry();
      const moved = patch(c.id, { bookId: book("Auto").id });
      expect(moved).toMatchObject({ bookName: "Auto", splitMode: "ownership" });
      expect(moved.shares).toEqual(c.shares);
    });

    it("does not move an entry into an archived book, but lets one that is there stay and change", async () => {
      await people(2);
      const ferien = newBook();
      const c = entry({ bookId: ferien.id });
      archive("Ferien");
      expect(patch(c.id, { title: "Nachtrag" }).title).toBe("Nachtrag");
      expect(
        patch(c.id, { bookId: ferien.id, title: "Noch einer" }).title,
      ).toBe("Noch einer");
      const other = entry();
      expect(() => patch(other.id, { bookId: ferien.id })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
      expect(() => patch(other.id, { bookId: "missing" })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
      expect(patch(c.id, { bookId: book("Haushalt").id }).bookName).toBe(
        "Haushalt",
      );
    });
  });

  describe("for whom: participants", () => {
    it("splits an equal entry among the chosen people only", async () => {
      const [a, b, c] = await people(3);
      const entryOf = entry({
        splitMode: "equal",
        participantIds: [a.id, c.id],
        amountMinor: 10001,
        paidByUserId: b.id,
      });
      expect(entryOf.splitMode).toBe("equal");
      expect(bps(entryOf)).toEqual({ [a.id]: 5000, [c.id]: 5000 });
      expect(parts(entryOf)).toEqual({ [a.id]: 5001, [c.id]: 5000 });
      expect(entryOf.paidByUserId).toBe(b.id);
    });

    it("gives the odd basis point and cent to the earlier user id, exactly", async () => {
      const [a, b, c] = await people(3);
      const entryOf = entry({
        splitMode: "equal",
        participantIds: [c.id, b.id, a.id],
        amountMinor: 100,
      });
      expect(bps(entryOf)).toEqual({
        [a.id]: 3334,
        [b.id]: 3333,
        [c.id]: 3333,
      });
      expect(Object.values(bps(entryOf)).reduce((x, y) => x + y, 0)).toBe(
        10000,
      );
      expect(parts(entryOf)).toEqual({ [a.id]: 34, [b.id]: 33, [c.id]: 33 });
      const two = entry({
        splitMode: "equal",
        participantIds: [c.id, b.id],
        amountMinor: 101,
      });
      expect(parts(two)).toEqual({ [b.id]: 51, [c.id]: 50 });
    });

    it("splits a refund among them like the expense", async () => {
      const [a, b] = await people(3);
      const entryOf = entry({
        splitMode: "equal",
        participantIds: [a.id, b.id],
        amountMinor: -101,
      });
      expect(parts(entryOf)).toEqual({ [a.id]: -51, [b.id]: -50 });
    });

    it("lets one person bear it alone", async () => {
      const [a] = await people(3);
      const entryOf = entry({ splitMode: "equal", participantIds: [a.id] });
      expect(bps(entryOf)).toEqual({ [a.id]: 10000 });
    });

    it("means everybody without participants, which is what equal always was", async () => {
      const [a, b, c] = await people(3);
      expect(bps(entry({ splitMode: "equal" }))).toEqual({
        [a.id]: 3334,
        [b.id]: 3333,
        [c.id]: 3333,
      });
      expect(
        bps(entry({ splitMode: "equal", participantIds: [a.id, b.id, c.id] })),
      ).toEqual({ [a.id]: 3334, [b.id]: 3333, [c.id]: 3333 });
    });

    it("applies when the book's default split is equal", async () => {
      const [a, b] = await people(3);
      const c = entry({
        bookId: book("Haushalt").id,
        participantIds: [a.id, b.id],
      });
      expect(c.splitMode).toBe("equal");
      expect(Object.keys(bps(c)).sort()).toEqual([a.id, b.id].sort());
      expect(() => entry({ participantIds: [a.id] })).toThrowError(
        expect.objectContaining({ code: "invalid_request" }),
      );
    });

    it.each([
      ["a stranger", () => ["missing"]],
      ["a person twice", (ids: string[]) => [ids[0], ids[0]]],
    ])("refuses %s", async (_name, pick) => {
      const [a] = await people(2);
      expect(() =>
        entry({ splitMode: "equal", participantIds: pick([a.id]) }),
      ).toThrowError(
        expect.objectContaining({
          code: "invalid_request",
          details: expect.objectContaining({
            body: expect.objectContaining({
              fieldErrors: { participantIds: [expect.any(String)] },
            }),
          }),
        }),
      );
    });

    it.each(["ownership", "none"])(
      "refuses participants for a %s split",
      async (splitMode) => {
        const [a] = await people(2);
        expect(() => entry({ splitMode, participantIds: [a.id] })).toThrowError(
          expect.objectContaining({ code: "invalid_request" }),
        );
      },
    );

    it("refuses participants next to custom shares", async () => {
      const [a, b] = await people(2);
      expect(() =>
        entry({
          splitMode: "custom",
          shares: [
            { userId: a.id, shareBps: 6000 },
            { userId: b.id, shareBps: 4000 },
          ],
          participantIds: [a.id],
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });

    it("freezes the split: a person who joins later bears nothing of it", async () => {
      const [a, b] = await people(2);
      const c = entry({ splitMode: "equal", participantIds: [a.id, b.id] });
      const d = await createTestUser({ displayName: "Spaeter" });
      const again = listCosts(ctx(), {}, { limit: 5 }, a.id).items[0];
      expect(again.shares.map((s) => s.userId).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(again.shares.some((s) => s.userId === d.id)).toBe(false);
      expect(c.id).toBe(again.id);
    });

    describe("changing them", () => {
      it("splits an equal entry again among the new people", async () => {
        const [a, b, c] = await people(3);
        const e = entry({ splitMode: "equal", amountMinor: 9000 });
        expect(Object.keys(bps(e))).toHaveLength(3);
        const next = patch(e.id, { participantIds: [b.id, c.id] });
        expect(next.splitMode).toBe("equal");
        expect(parts(next)).toEqual({ [b.id]: 4500, [c.id]: 4500 });
        expect(parts(patch(e.id, { participantIds: [a.id] }))).toEqual({
          [a.id]: 9000,
        });
      });

      it("keeps the participants when only the amount changes", async () => {
        const [a, b] = await people(3);
        const e = entry({
          splitMode: "equal",
          participantIds: [a.id, b.id],
          amountMinor: 1000,
        });
        const next = patch(e.id, { amountMinor: 1501 });
        expect(bps(next)).toEqual({ [a.id]: 5000, [b.id]: 5000 });
        expect(parts(next)).toEqual({ [a.id]: 751, [b.id]: 750 });
      });

      it("takes everybody back with equal and no participants", async () => {
        const [a, b, c] = await people(3);
        const e = entry({ splitMode: "equal", participantIds: [a.id, b.id] });
        const next = patch(e.id, { splitMode: "equal" });
        expect(Object.keys(bps(next)).sort()).toEqual(
          [a.id, b.id, c.id].sort(),
        );
      });

      it("sets the split and the participants in one request", async () => {
        const [a, b] = await people(3);
        const e = entry();
        expect(e.splitMode).toBe("ownership");
        const next = patch(e.id, {
          splitMode: "equal",
          participantIds: [a.id, b.id],
        });
        expect(next.splitMode).toBe("equal");
        expect(Object.keys(bps(next)).sort()).toEqual([a.id, b.id].sort());
      });

      it("changes custom shares alone, without a new split mode in the request", async () => {
        const [a, b] = await people(2);
        const e = entry({
          splitMode: "custom",
          shares: [
            { userId: a.id, shareBps: 6000 },
            { userId: b.id, shareBps: 4000 },
          ],
        });
        const next = patch(e.id, {
          shares: [
            { userId: a.id, shareBps: 2500 },
            { userId: b.id, shareBps: 7500 },
          ],
        });
        expect(next.splitMode).toBe("custom");
        expect(bps(next)).toEqual({ [a.id]: 2500, [b.id]: 7500 });
      });

      it("needs an equal split", async () => {
        const [a] = await people(2);
        const e = entry();
        expect(() => patch(e.id, { participantIds: [a.id] })).toThrowError(
          expect.objectContaining({ code: "invalid_request" }),
        );
        expect(() =>
          patch(e.id, { splitMode: "none", participantIds: [a.id] }),
        ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
        const custom = entry({
          splitMode: "custom",
          shares: [{ userId: a.id, shareBps: 10000 }],
        });
        expect(() => patch(custom.id, { participantIds: [a.id] })).toThrowError(
          expect.objectContaining({ code: "invalid_request" }),
        );
        expect(() =>
          patch(e.id, { participantIds: ["missing"], splitMode: "equal" }),
        ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      });

      it("leaves the entry as it was when the request is refused", async () => {
        const [a] = await people(2);
        const e = entry({ splitMode: "equal" });
        expect(() =>
          patch(e.id, { title: "Neu", participantIds: [a.id, a.id] }),
        ).toThrow();
        const again = listCosts(ctx(), {}, { limit: 5 }, a.id).items[0];
        expect(again.title).toBe("Einkauf");
        expect(again.shares).toEqual(e.shares);
      });
    });
  });
});
