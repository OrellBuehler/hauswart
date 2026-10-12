import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConnectionRow } from "$lib/server/connections/connections";
import {
  defaultCostBook,
  listCostBooks,
  updateCostBook,
} from "$lib/server/costs/books";
import { getCost } from "$lib/server/costs/costs";
import { costEntries, financeSuggestions } from "$lib/server/db";
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  type SuggestionRow,
} from "$lib/server/finance/suggestions";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { parseConfig } from "./config";
import { fakeBill, fakeTransaction } from "./fake-server";
import { syncConnection } from "./sync";
import { useFakeKept } from "./testing";

const ORIGIN = "https://hauswart.example.org";

describe("Kept and the cost books", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeKept();
  const ctx = () => ctxAt(test.db);
  let previousOrigin: string | undefined;
  beforeEach(() => {
    previousOrigin = process.env.ORIGIN;
    process.env.ORIGIN = ORIGIN;
  });
  afterEach(() => {
    if (previousOrigin === undefined) delete process.env.ORIGIN;
    else process.env.ORIGIN = previousOrigin;
  });

  const book = (name: string) => {
    const found = listCostBooks(
      ctx(),
      { includeArchived: true },
      { limit: 50 },
    ).items.find((b) => b.name === name);
    if (!found) throw new Error(`no book ${name}`);
    return found;
  };
  const archive = (name: string) =>
    updateCostBook(ctx(), book(name).id, { archived: true });
  const MAP = { "cat-repair": "repair", "cat-utilities": "utilities" };
  async function setup(config: Record<string, unknown>) {
    const user = await createTestUser({ displayName: "Anna" });
    connect(user.id, { config: { categoryMap: MAP, ...config } });
    return user;
  }
  const run = (userId: string) =>
    syncConnection(ctx(), getConnectionRow(ctx(), "kept", userId)!);
  const pending = (userId: string) =>
    listSuggestions(
      ctx(),
      userId,
      { kind: "cost", status: "pending" },
      { limit: 200 },
    ).items;
  const payload = (s: SuggestionRow) =>
    s.payloadJson as Record<string, unknown>;
  const bookOffered = (userId: string) =>
    Object.fromEntries(
      pending(userId).map((r) => [r.providerRef, payload(r).bookId ?? null]),
    );
  const tx = (id: string, over: Parameters<typeof fakeTransaction>[0] = {}) =>
    fakeTransaction({ id, categoryId: "cat-repair", ...over });

  describe("what the settings say", () => {
    it("keeps the book of every mapped category and the default book, and drops books of categories that are not mapped", () => {
      expect(
        parseConfig({
          categoryMap: MAP,
          categoryBookMap: {
            "cat-repair": " book-1 ",
            "cat-other": "book-2",
          },
          defaultBookId: "book-3",
        }),
      ).toMatchObject({
        categoryBookMap: { "cat-repair": "book-1" },
        defaultBookId: "book-3",
      });
    });

    it("is empty without them, and refuses what is not an id", () => {
      expect(parseConfig({ categoryMap: MAP })).toMatchObject({
        categoryBookMap: {},
      });
      expect(parseConfig({ categoryMap: MAP }).defaultBookId).toBeUndefined();
      for (const bad of [
        { categoryBookMap: { "cat-repair": "" } },
        { categoryBookMap: { "cat-repair": 3 } },
        { categoryBookMap: { "cat-repair": "x".repeat(65) } },
        { defaultBookId: "" },
        { defaultBookId: 4 },
      ]) {
        expect(() => parseConfig({ categoryMap: MAP, ...bad })).toThrowError(
          expect.objectContaining({ code: "invalid_input" }),
        );
      }
    });
  });

  describe("a transaction is offered with a book", () => {
    it("the book of its category, else the connection's default, else none", async () => {
      const user = await setup({
        categoryBookMap: { "cat-repair": book("Haushalt").id },
        defaultBookId: book("Auto").id,
      });
      fake.transactions = [tx("t1"), tx("t2", { categoryId: "cat-utilities" })];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({
        "tx:t1": book("Haushalt").id,
        "tx:t2": book("Auto").id,
      });
    });

    it("none without settings: the default book takes it when accepted", async () => {
      const user = await setup({});
      fake.transactions = [tx("t1")];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "tx:t1": null });
      const [row] = pending(user.id);
      const accepted = await acceptSuggestion(ctx(), user.id, row.id, {});
      expect(getCost(ctx(), accepted.entity.id).bookId).toBe(
        defaultCostBook(ctx()).id,
      );
    });

    it("the book of a category that was archived or deleted counts as none, and the next choice is tried", async () => {
      const user = await setup({
        categoryBookMap: {
          "cat-repair": book("Auto").id,
          "cat-utilities": "gone",
        },
        defaultBookId: book("Haushalt").id,
      });
      fake.transactions = [tx("t1"), tx("t2", { categoryId: "cat-utilities" })];
      archive("Auto");
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({
        "tx:t1": book("Haushalt").id,
        "tx:t2": book("Haushalt").id,
      });

      archive("Haushalt");
      fake.transactions = [
        tx("t1", { updatedAt: "2026-09-30T10:00:00.000Z" }),
        tx("t2", {
          categoryId: "cat-utilities",
          updatedAt: "2026-09-30T10:00:00.000Z",
        }),
      ];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "tx:t1": null, "tx:t2": null });
    });

    it("a changed mapping reaches the suggestion that is still waiting", async () => {
      const user = await setup({
        categoryBookMap: { "cat-repair": book("Haushalt").id },
      });
      fake.transactions = [tx("t1")];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "tx:t1": book("Haushalt").id });

      connect(user.id, {
        config: {
          categoryMap: MAP,
          categoryBookMap: { "cat-repair": book("Auto").id },
        },
      });
      fake.transactions = [tx("t1", { updatedAt: "2026-09-30T10:00:00.000Z" })];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "tx:t1": book("Auto").id });
    });

    describe("a changed mapping is read again, whatever the age of the transactions", () => {
      const AGES = {
        old: "2026-02-01T10:00:00.000Z",
        middle: "2026-04-01T10:00:00.000Z",
        recent: "2026-09-01T10:00:00.000Z",
      };
      const decided = (userId: string) =>
        Object.fromEntries(
          test.db
            .select()
            .from(financeSuggestions)
            .all()
            .filter((s) => s.userId === userId && s.status !== "pending")
            .map((s) => [s.providerRef, payload(s).bookId ?? null]),
        );
      const transactionReads = () => fake.requestsTo("/transactions", "GET");

      it("re-scopes the waiting offers of transactions nothing changed upstream, and leaves the decided ones as they were", async () => {
        const user = await setup({
          categoryBookMap: { "cat-repair": book("Haushalt").id },
        });
        fake.transactions = [
          tx("t-old", { updatedAt: AGES.old }),
          tx("t-recent", { updatedAt: AGES.recent }),
          tx("t-dismissed", { updatedAt: AGES.old }),
          tx("t-accepted", { updatedAt: AGES.middle }),
        ];
        await run(user.id);
        const row = (ref: string) =>
          pending(user.id).find((r) => r.providerRef === ref)!;
        dismissSuggestion(ctx(), user.id, row("tx:t-dismissed").id);
        const accepted = await acceptSuggestion(
          ctx(),
          user.id,
          row("tx:t-accepted").id,
          {},
        );

        connect(user.id, {
          config: {
            categoryMap: MAP,
            categoryBookMap: { "cat-repair": book("Auto").id },
          },
        });
        fake.requests = [];
        await run(user.id);

        // Nothing changed in Kept, yet every transaction was read again and the waiting ones took the new book.
        expect(
          transactionReads().every((r) => r.query.get("updatedSince") === null),
        ).toBe(true);
        expect(bookOffered(user.id)).toEqual({
          "tx:t-old": book("Auto").id,
          "tx:t-recent": book("Auto").id,
        });
        expect(decided(user.id)).toEqual({
          "tx:t-dismissed": book("Haushalt").id,
          "tx:t-accepted": book("Haushalt").id,
        });
        expect(getCost(ctx(), accepted.entity.id).bookId).toBe(
          book("Haushalt").id,
        );

        // The same mapping again keeps the cursor: only what changed since is asked for.
        fake.requests = [];
        await run(user.id);
        expect(
          transactionReads().every(
            (r) => r.query.get("updatedSince") === AGES.recent,
          ),
        ).toBe(true);
        expect(transactionReads().length).toBeGreaterThan(0);
      });

      it("does the same when only the connection's default book changes", async () => {
        const user = await setup({ defaultBookId: book("Haushalt").id });
        fake.transactions = [
          tx("t-old", { updatedAt: AGES.old }),
          tx("t-recent", { updatedAt: AGES.recent }),
        ];
        await run(user.id);
        expect(bookOffered(user.id)).toEqual({
          "tx:t-old": book("Haushalt").id,
          "tx:t-recent": book("Haushalt").id,
        });

        connect(user.id, {
          config: { categoryMap: MAP, defaultBookId: book("Auto").id },
        });
        await run(user.id);
        expect(bookOffered(user.id)).toEqual({
          "tx:t-old": book("Auto").id,
          "tx:t-recent": book("Auto").id,
        });
      });

      it("does not read the transactions again for the order of the entries or a book of a category that is not read", async () => {
        const user = await setup({
          categoryBookMap: {
            "cat-repair": book("Haushalt").id,
            "cat-utilities": book("Auto").id,
          },
        });
        fake.transactions = [tx("t-old", { updatedAt: AGES.old })];
        await run(user.id);

        connect(user.id, {
          config: {
            categoryMap: MAP,
            categoryBookMap: {
              "cat-utilities": book("Auto").id,
              "cat-repair": book("Haushalt").id,
              "cat-unmapped": book("Wohnung").id,
            },
          },
        });
        fake.requests = [];
        await run(user.id);
        expect(
          transactionReads().every(
            (r) => r.query.get("updatedSince") === AGES.old,
          ),
        ).toBe(true);
      });
    });

    it("a book archived after the offer is not used when accepting without a book", async () => {
      const user = await setup({
        categoryBookMap: { "cat-repair": book("Haushalt").id },
      });
      fake.transactions = [tx("t1")];
      await run(user.id);
      const [row] = pending(user.id);
      archive("Haushalt");
      const accepted = await acceptSuggestion(ctx(), user.id, row.id, {});
      expect(getCost(ctx(), accepted.entity.id).bookId).toBe(
        defaultCostBook(ctx()).id,
      );
    });
  });

  describe("automatic booking", () => {
    it("books into the book of the category and splits as that book says", async () => {
      const user = await setup({
        autoAcceptCategoryIds: ["cat-repair", "cat-utilities"],
        categoryBookMap: { "cat-repair": book("Haushalt").id },
      });
      fake.transactions = [tx("t1"), tx("t2", { categoryId: "cat-utilities" })];
      const result = await run(user.id);
      expect(result.stats).toMatchObject({ autoAccepted: 2 });
      const entries = test.db.select().from(costEntries).all();
      const by = Object.fromEntries(entries.map((e) => [e.providerRef, e]));
      expect(by["tx:t1"]).toMatchObject({
        bookId: book("Haushalt").id,
        splitMode: "equal",
      });
      // a category without a book goes where entries without a book go
      expect(by["tx:t2"]).toMatchObject({
        bookId: book("Wohnung").id,
        splitMode: "ownership",
      });
    });

    it("books into the connection's default book for a category without one of its own", async () => {
      const user = await setup({
        autoAcceptCategoryIds: ["cat-repair"],
        defaultBookId: book("Auto").id,
      });
      fake.transactions = [tx("t1")];
      await run(user.id);
      expect(test.db.select().from(costEntries).get()).toMatchObject({
        bookId: book("Auto").id,
        splitMode: "equal",
      });
    });

    it("books into the default book when the book of the category is archived", async () => {
      const user = await setup({
        autoAcceptCategoryIds: ["cat-repair"],
        categoryBookMap: { "cat-repair": book("Auto").id },
      });
      archive("Auto");
      fake.transactions = [tx("t1")];
      const result = await run(user.id);
      expect(result).toMatchObject({ ok: true, stats: { autoAccepted: 1 } });
      expect(test.db.select().from(costEntries).get()).toMatchObject({
        bookId: book("Wohnung").id,
      });
    });
  });

  describe("paid invoices", () => {
    it("are offered with the connection's default book", async () => {
      const user = await setup({
        billCostCategory: "utilities",
        defaultBookId: book("Haushalt").id,
        categoryBookMap: { "cat-repair": book("Auto").id },
      });
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
        }),
      ];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "bill:b1": book("Haushalt").id });
    });

    it("take a changed default book at the next run although the invoice did not change, and ignore a changed book of a category", async () => {
      const user = await setup({
        billCostCategory: "utilities",
        defaultBookId: book("Haushalt").id,
        categoryBookMap: { "cat-repair": book("Auto").id },
      });
      fake.bills = [
        fakeBill({
          id: "b1",
          status: "paid",
          amount: 33000,
          remainingAmount: 0,
          lastPaymentDate: "2026-04-20",
          updatedAt: "2026-04-21T08:00:00.000Z",
        }),
      ];
      await run(user.id);
      expect(bookOffered(user.id)).toEqual({ "bill:b1": book("Haushalt").id });

      // Invoices have no category of their own, so the book of a category does not concern them.
      connect(user.id, {
        config: {
          categoryMap: MAP,
          billCostCategory: "utilities",
          defaultBookId: book("Haushalt").id,
          categoryBookMap: { "cat-repair": book("Wohnung").id },
        },
      });
      fake.requests = [];
      await run(user.id);
      const paidReads = () =>
        fake
          .requestsTo("/bills", "GET")
          .filter((r) => r.query.get("status") === "paid");
      expect(paidReads().length).toBeGreaterThan(0);
      expect(
        paidReads().every(
          (r) => r.query.get("updatedSince") === "2026-04-21T08:00:00.000Z",
        ),
      ).toBe(true);

      connect(user.id, {
        config: {
          categoryMap: MAP,
          billCostCategory: "utilities",
          defaultBookId: book("Auto").id,
        },
      });
      fake.requests = [];
      await run(user.id);
      expect(paidReads().length).toBeGreaterThan(0);
      expect(
        paidReads().every((r) => r.query.get("updatedSince") === null),
      ).toBe(true);
      expect(bookOffered(user.id)).toEqual({ "bill:b1": book("Auto").id });
    });
  });
});
