import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { updateCostRequestSchema } from "$lib/api/schemas/costs";
import { createCostRecurrenceRequestSchema } from "$lib/api/schemas/cost-recurrences";
import { saveConnection } from "$lib/server/connections/connections";
import {
  createCost,
  deleteCost,
  getCost,
  listCosts,
  updateCost,
} from "$lib/server/costs/costs";
import {
  bookDueRecurrences,
  createCostRecurrence,
  runCostRecurrenceNow,
} from "$lib/server/costs/recurrences";
import { costEntries, financeSuggestions, type DB } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { createTestUser } from "$lib/testing/auth";
import { at, ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { createCostTag } from "$lib/server/costs/tags";
import {
  acceptSuggestion,
  dismissSuggestion,
  getOwnSuggestion,
  listSuggestions,
  matchingCostSuggestions,
  payloadOf,
  recordSuggestion,
  suggestionsCoveringBill,
  type SuggestionInput,
} from "./suggestions";

describe("tying cost entries to transactions", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  async function owner(name = "Anna") {
    const user = await createTestUser({ displayName: name });
    const connection = saveConnection(ctx(), "kept", user.id, {
      baseUrl: "https://finance.example.org",
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    return { user, connection };
  }
  type Owner = Awaited<ReturnType<typeof owner>>;

  const txPayload = (over: Record<string, unknown> = {}) => ({
    source: "finance_transaction",
    date: "2026-06-10",
    amountMinor: 4250,
    currency: "CHF",
    title: "BEISPIEL MARKT ZUERICH",
    payee: "Beispiel Markt",
    category: "groceries",
    url: "https://finance.example.org/tx/1",
    assetId: null,
    ...over,
  });
  const offer = (
    o: Owner,
    over: Partial<SuggestionInput> = {},
    status: "pending" | "dismissed" = "pending",
  ) =>
    recordSuggestion(
      ctx(),
      {
        connectionId: o.connection.id,
        userId: o.user.id,
        kind: "cost",
        providerRef: "tx:1",
        payload: txPayload(),
        ...over,
      },
      status,
    );
  /** The n-th entry made, each a minute after the one before, so "older" means something. */
  let minutes = 0;
  const entry = (
    o: Owner,
    over: Record<string, unknown> = {},
    by: string | null = o.user.id,
  ) =>
    createCost(
      ctxAt(test.db, ctx().now + ++minutes * 60_000),
      createCostRequestSchema.parse({
        title: "Einkauf Beispiel Markt",
        amountMinor: 4250,
        category: "groceries",
        date: "2026-06-10",
        paidByUserId: o.user.id,
        splitMode: "none",
        ...over,
      }),
      by,
    );
  const rows = (kind?: "cost" | "link", userId?: string) =>
    test.db
      .select()
      .from(financeSuggestions)
      .all()
      .filter(
        (r) => (!kind || r.kind === kind) && (!userId || r.userId === userId),
      );

  describe("recording a transaction that matches an entry made by hand", () => {
    it("records a link to the entry instead of a cost, and no cost suggestion", async () => {
      const a = await owner();
      const e = entry(a);
      const { row, created } = offer(a, { billRefs: ["b1"] });
      expect(created).toBe(true);
      expect(row).toMatchObject({
        kind: "link",
        status: "pending",
        providerRef: "tx:1",
        userId: a.user.id,
        connectionId: a.connection.id,
        billRefsJson: ["b1"],
      });
      expect(payloadOf(row)).toEqual({
        entryId: e.id,
        transaction: { ...txPayload(), bookId: null },
      });
      expect(rows("cost")).toEqual([]);
    });

    it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
      ["another amount", {}, { amountMinor: 4251 }],
      ["another currency", {}, { currency: "EUR" }],
      ["a refund of the same amount", {}, { amountMinor: -4250 }],
      ["four days earlier", {}, { date: "2026-06-06" }],
      ["four days later", {}, { date: "2026-06-14" }],
      ["another shop", {}, { title: "MUSTER LADEN", payee: "Muster Laden" }],
      ["an entry without a payer", { paidByUserId: null }, {}],
    ])("records a cost for %s", async (_name, entryOver, txOver) => {
      const a = await owner();
      entry(a, entryOver);
      const { row } = offer(a, { payload: txPayload(txOver) });
      expect(row.kind).toBe("cost");
    });

    it.each<[string, Record<string, unknown>]>([
      ["three days earlier", { date: "2026-06-07" }],
      ["three days later", { date: "2026-06-13" }],
      [
        "the payee carrying the words",
        { title: "Karte 1234", payee: "Beispiel Markt" },
      ],
    ])("links %s", async (_name, txOver) => {
      const a = await owner();
      entry(a);
      expect(offer(a, { payload: txPayload(txOver) }).row.kind).toBe("link");
    });

    it("leaves out entries somebody else paid", async () => {
      const a = await owner();
      const b = await owner("Ben");
      entry(a, { paidByUserId: b.user.id }, a.user.id);
      expect(offer(a).row.kind).toBe("cost");
      expect(offer(b, { providerRef: "tx:2" }).row.kind).toBe("link");
    });

    it("finds an entry made by one person that the other paid, whoever made it", async () => {
      const a = await owner();
      const b = await owner("Ben");
      const e = entry(a, { paidByUserId: b.user.id }, a.user.id);
      const { row } = offer(b);
      expect(row.kind).toBe("link");
      expect(payloadOf(row)).toMatchObject({ entryId: e.id });
    });

    it("leaves out entries that came from a finance app or are tied to an item already", async () => {
      const a = await owner();
      const e1 = entry(a);
      test.db
        .update(costEntries)
        .set({ source: "finance_transaction" })
        .where(eq(costEntries.id, e1.id))
        .run();
      const e2 = entry(a);
      test.db
        .update(costEntries)
        .set({ providerRef: "tx:other", providerConnectionId: a.connection.id })
        .where(eq(costEntries.id, e2.id))
        .run();
      expect(offer(a).row.kind).toBe("cost");
    });

    it("also finds an entry a recurring cost booked", async () => {
      const a = await owner();
      const e = entry(a);
      test.db
        .update(costEntries)
        .set({ source: "recurring" })
        .where(eq(costEntries.id, e.id))
        .run();
      expect(offer(a).row.kind).toBe("link");
    });

    it("picks the entry with the most similar text first", async () => {
      const a = await owner();
      entry(a, { title: "Einkauf Beispiel Markt", date: "2026-06-10" });
      const best = entry(a, {
        title: "BEISPIEL MARKT ZUERICH",
        date: "2026-06-12",
      });
      entry(a, { title: "Einkauf Beispiel Markt", date: "2026-06-10" });
      expect(payloadOf(offer(a).row)).toMatchObject({ entryId: best.id });
    });

    it("then the nearer date", async () => {
      const a = await owner();
      entry(a, { title: "Beispiel Markt", date: "2026-06-09" });
      entry(a, { title: "Beispiel Markt", date: "2026-06-11" });
      const closer = entry(a, { title: "Beispiel Markt", date: "2026-06-10" });
      entry(a, { title: "Beispiel Markt", date: "2026-06-12" });
      expect(payloadOf(offer(a).row)).toMatchObject({ entryId: closer.id });
    });

    it("then the entry that was made first", async () => {
      const a = await owner();
      const older = entry(a, { title: "Beispiel Markt", date: "2026-06-11" });
      entry(a, { title: "Beispiel Markt", date: "2026-06-09" });
      expect(payloadOf(offer(a).row)).toMatchObject({ entryId: older.id });
    });

    it("pairs two alike transactions with two alike entries, one each", async () => {
      const a = await owner();
      const e1 = entry(a);
      const e2 = entry(a);
      const first = offer(a, { providerRef: "tx:1" }).row;
      const second = offer(a, { providerRef: "tx:2" }).row;
      const third = offer(a, { providerRef: "tx:3" }).row;
      expect([first.kind, second.kind, third.kind]).toEqual([
        "link",
        "link",
        "cost",
      ]);
      expect(
        new Set([
          (payloadOf(first) as { entryId: string }).entryId,
          (payloadOf(second) as { entryId: string }).entryId,
        ]),
      ).toEqual(new Set([e1.id, e2.id]));
    });

    it("never links something that was recorded as decided already", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a, {}, "dismissed");
      expect(row).toMatchObject({ kind: "cost", status: "dismissed" });
    });

    it("keeps a link a link when the item is recorded again, with the transaction as it is now", async () => {
      const a = await owner();
      const e = entry(a);
      const first = offer(a).row;
      const again = offer(a, {
        payload: txPayload({ title: "BEISPIEL MARKT ZUERICH HB" }),
        billRefs: ["b9"],
      });
      expect(again.created).toBe(false);
      expect(again.row.id).toBe(first.id);
      expect(payloadOf(again.row)).toMatchObject({
        entryId: e.id,
        transaction: { title: "BEISPIEL MARKT ZUERICH HB" },
      });
      expect(again.row.billRefsJson).toEqual(["b9"]);
      expect(rows("cost")).toEqual([]);
      expect(rows("link")).toHaveLength(1);
    });

    it("does not link again what already has a cost suggestion", async () => {
      const a = await owner();
      const { row: cost } = offer(a, { providerRef: "tx:1" });
      offer(a, { providerRef: "tx:2" });
      // Two offers fit the entry, so it is taken for neither of them.
      entry(a);
      const again = offer(a, { providerRef: "tx:1" });
      expect(again.created).toBe(false);
      expect(again.row.id).toBe(cost.id);
      expect(rows("link")).toEqual([]);
    });

    it("does not link something that does not parse as a cost", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a, { payload: { title: "no amount" } });
      expect(row.kind).toBe("cost");
    });
  });

  describe("an entry that is booked after the offer", () => {
    it("turns the waiting cost suggestion into a link to the entry, where it was", async () => {
      const a = await owner();
      const { row: cost } = offer(a, { billRefs: ["b1"] });
      const e = entry(a);
      expect(rows("cost")).toEqual([]);
      const [link] = rows("link");
      expect(link).toMatchObject({
        id: cost.id,
        kind: "link",
        status: "pending",
        providerRef: "tx:1",
        userId: a.user.id,
        connectionId: a.connection.id,
        billRefsJson: ["b1"],
        createdAt: cost.createdAt,
      });
      expect(payloadOf(link)).toEqual({
        entryId: e.id,
        transaction: { ...txPayload(), bookId: null },
      });
      expect(getCost(ctx(), e.id).providerRef).toBeNull();
    });

    it("never accepts it by itself: accepting the link ties the entry and books nothing more", async () => {
      const a = await owner();
      offer(a);
      const e = entry(a);
      expect(getCost(ctx(), e.id)).toMatchObject({
        providerRef: null,
        providerConnectionId: null,
      });
      const [link] = rows("link");
      expect(link.status).toBe("pending");
      const { entity } = await acceptSuggestion(ctx(), a.user.id, link.id, {});
      expect(entity).toEqual({ type: "cost", id: e.id });
      expect(getCost(ctx(), e.id)).toMatchObject({
        providerConnectionId: a.connection.id,
        providerRef: "tx:1",
      });
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toHaveLength(
        1,
      );
    });

    it("gives the transaction back as a cost when the link is dismissed", async () => {
      const a = await owner();
      offer(a, { billRefs: ["b1"] });
      entry(a);
      const [link] = rows("link");
      dismissSuggestion(ctx(), a.user.id, link.id);
      const [cost] = rows("cost");
      expect(cost).toMatchObject({
        status: "pending",
        providerRef: "tx:1",
        billRefsJson: ["b1"],
      });
      expect(payloadOf(cost)).toMatchObject({
        title: "BEISPIEL MARKT ZUERICH",
        amountMinor: 4250,
      });
    });

    it("keeps the link a link when the provider reports the transaction again", async () => {
      const a = await owner();
      offer(a);
      const e = entry(a);
      const again = offer(a, {
        payload: txPayload({ title: "BEISPIEL MARKT ZUERICH HB" }),
      });
      expect(again.created).toBe(false);
      expect(again.row).toMatchObject({ kind: "link", status: "pending" });
      expect(payloadOf(again.row)).toMatchObject({
        entryId: e.id,
        transaction: { title: "BEISPIEL MARKT ZUERICH HB" },
      });
      expect(rows("cost")).toEqual([]);
    });

    it("also finds an entry whose payer is somebody else than the one who made it", async () => {
      const a = await owner();
      const b = await owner("Ben");
      offer(b);
      const e = entry(a, { paidByUserId: b.user.id }, a.user.id);
      const [link] = rows("link");
      expect(link.userId).toBe(b.user.id);
      expect(payloadOf(link)).toMatchObject({ entryId: e.id });
    });

    it.each<[string, Record<string, unknown>]>([
      ["another amount", { amountMinor: 4251 }],
      ["another currency", { currency: "EUR" }],
      ["a refund of the same amount", { amountMinor: -4250 }],
      ["four days earlier", { date: "2026-06-06" }],
      ["four days later", { date: "2026-06-14" }],
      ["another shop", { title: "MUSTER LADEN", payee: "Muster Laden" }],
      ["no payer", { paidByUserId: null }],
    ])("leaves the offer alone for an entry with %s", async (_name, over) => {
      const a = await owner();
      offer(a);
      entry(a, over);
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => r.status)).toEqual(["pending"]);
    });

    it("leaves the offer alone for an entry somebody else paid", async () => {
      const a = await owner();
      const b = await owner("Ben");
      offer(a);
      entry(a, { paidByUserId: b.user.id }, a.user.id);
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => r.userId)).toEqual([a.user.id]);
    });

    it("leaves other people's offers alone", async () => {
      const a = await owner();
      const b = await owner("Ben");
      offer(b, { providerRef: "tx:theirs" });
      entry(a);
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => r.userId)).toEqual([b.user.id]);
    });

    it("leaves decided offers and offers of other kinds alone", async () => {
      const a = await owner();
      offer(a, { providerRef: "tx:done" }, "dismissed");
      const accepted = offer(a, { providerRef: "tx:accepted" }).row;
      await acceptSuggestion(ctx(), a.user.id, accepted.id, {});
      offer(a, {
        providerRef: "tx:asset",
        kind: "asset",
        payload: {
          name: "Herd",
          purchaseDate: "2026-06-10",
          priceMinor: 4250,
          currency: "CHF",
          url: null,
        },
      });
      entry(a);
      expect(rows("link")).toEqual([]);
      expect(rows().map((r) => [r.kind, r.status])).toEqual([
        ["cost", "dismissed"],
        ["cost", "accepted"],
        ["asset", "pending"],
      ]);
    });

    it("takes the entry for none of two offers that both fit it", async () => {
      const a = await owner();
      offer(a, { providerRef: "tx:1" });
      offer(a, { providerRef: "tx:2" });
      entry(a);
      expect(rows("link")).toEqual([]);
      expect(rows("cost")).toHaveLength(2);
    });

    it("does not touch the other offers when the entry is tied to a transaction while it is typed", async () => {
      const a = await owner();
      const { row } = offer(a, { providerRef: "tx:1" });
      offer(a, { providerRef: "tx:2" });
      const e = createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Einkauf Beispiel Markt",
          amountMinor: 4250,
          category: "groceries",
          date: "2026-06-10",
          paidByUserId: a.user.id,
          financeSuggestionId: row.id,
          splitMode: "none",
        }),
        a.user.id,
      );
      expect(e.providerRef).toBe("tx:1");
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => [r.providerRef, r.status])).toEqual([
        ["tx:1", "accepted"],
        ["tx:2", "pending"],
      ]);
    });

    it("does not touch the other offers when an entry is booked from the inbox", async () => {
      const a = await owner();
      const { row } = offer(a, { providerRef: "tx:1" });
      offer(a, { providerRef: "tx:2" });
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => [r.providerRef, r.status])).toEqual([
        ["tx:1", "accepted"],
        ["tx:2", "pending"],
      ]);
    });

    it("does not link a transaction again whose link was turned down, and books the entry all the same", async () => {
      const a = await owner();
      offer(a);
      entry(a);
      const [link] = rows("link");
      dismissSuggestion(ctx(), a.user.id, link.id);
      const second = entry(a, { title: "Einkauf Beispiel Markt Nachtrag" });
      expect(getCost(ctx(), second.id).providerRef).toBeNull();
      expect(rows("link").map((r) => r.status)).toEqual(["dismissed"]);
      expect(rows("cost").map((r) => r.status)).toEqual(["pending"]);
    });

    it("books an entry that fits nothing as it always did", async () => {
      const a = await owner();
      const e = entry(a);
      expect(getCost(ctx(), e.id).source).toBe("manual");
      expect(rows()).toEqual([]);
    });

    it("works inside the booking: nothing is left of the link when the booking is rolled back", async () => {
      const a = await owner();
      offer(a);
      const now = ctx().now;
      expect(() =>
        test.db.transaction((tx) => {
          createCost(
            { db: tx as unknown as DB, now },
            createCostRequestSchema.parse({
              title: "Einkauf Beispiel Markt",
              amountMinor: 4250,
              category: "groceries",
              date: "2026-06-10",
              paidByUserId: a.user.id,
              splitMode: "none",
            }),
            a.user.id,
          );
          expect(rows("link")).toHaveLength(1);
          throw new Error("rolled back");
        }),
      ).toThrow("rolled back");
      expect(rows("link")).toEqual([]);
      expect(rows("cost").map((r) => r.status)).toEqual(["pending"]);
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toEqual([]);
    });

    describe("by a recurring cost", () => {
      const rent = (a: Owner, over: Record<string, unknown> = {}) =>
        createCostRecurrence(
          ctx(),
          createCostRecurrenceRequestSchema.parse({
            title: "Miete",
            amountMinor: 150000,
            category: "other",
            frequency: "monthly",
            startDate: "2026-02-05",
            paidByUserId: a.user.id,
            splitMode: "none",
            ...over,
          }),
          a.user.id,
        );
      const rentOffer = (a: Owner, over: Record<string, unknown> = {}) =>
        offer(a, {
          providerRef: "tx:rent",
          payload: txPayload({
            date: "2026-02-03",
            amountMinor: 150000,
            title: "MIETE FEBRUAR BEISPIEL VERWALTUNG",
            payee: "Beispiel Verwaltung",
            category: "other",
            ...over,
          }),
        }).row;
      const bookOn = (date: string) =>
        bookDueRecurrences(ctxAt(test.db, at(date)));

      it("turns the offer that came first into a link, and accepting it ties the booked entry instead of booking another", async () => {
        const a = await owner();
        const waiting = rentOffer(a);
        expect(waiting.kind).toBe("cost");
        rent(a);
        expect(bookOn("2026-02-05")).toEqual({ booked: 1, failed: 0 });
        const [entryRow] = test.db.select().from(costEntries).all();
        expect(entryRow).toMatchObject({
          source: "recurring",
          providerRef: null,
        });
        expect(rows("cost")).toEqual([]);
        const [link] = rows("link");
        expect(link).toMatchObject({ id: waiting.id, status: "pending" });
        expect(payloadOf(link)).toMatchObject({ entryId: entryRow.id });

        const { entity } = await acceptSuggestion(
          ctx(),
          a.user.id,
          link.id,
          {},
        );
        expect(entity).toEqual({ type: "cost", id: entryRow.id });
        expect(test.db.select().from(costEntries).all()).toHaveLength(1);
        expect(getCost(ctx(), entryRow.id)).toMatchObject({
          source: "recurring",
          providerRef: "tx:rent",
          providerConnectionId: a.connection.id,
        });
        // The provider reporting the payment again changes nothing.
        expect(rentOffer(a)).toMatchObject({
          kind: "link",
          status: "accepted",
        });
        expect(rows("cost")).toEqual([]);
      });

      it("does the same when the booking is made by hand with run-now", async () => {
        const a = await owner();
        rentOffer(a);
        const r = rent(a);
        runCostRecurrenceNow(ctxAt(test.db, at("2026-02-05")), r.id);
        expect(rows("cost")).toEqual([]);
        expect(rows("link")).toHaveLength(1);
      });

      it("links the occurrence it books to the offer, not the ones it books later", async () => {
        const a = await owner();
        rentOffer(a);
        rent(a);
        bookOn("2026-04-05");
        const entriesBooked = test.db.select().from(costEntries).all();
        expect(entriesBooked.map((e) => e.date).sort()).toEqual([
          "2026-02-05",
          "2026-03-05",
          "2026-04-05",
        ]);
        const [link] = rows("link");
        const target = entriesBooked.find(
          (e) => e.id === (payloadOf(link) as { entryId: string }).entryId,
        );
        expect(target?.date).toBe("2026-02-05");
      });

      it("leaves an offer for another payer or another amount to be booked as a cost", async () => {
        const a = await owner();
        const b = await owner("Ben");
        rentOffer(a, { amountMinor: 150001 });
        offer(b, {
          providerRef: "tx:rent-b",
          payload: txPayload({
            date: "2026-02-03",
            amountMinor: 150000,
            title: "MIETE FEBRUAR",
            payee: null,
            category: "other",
          }),
        });
        rent(a);
        bookOn("2026-02-05");
        expect(rows("link")).toEqual([]);
        expect(rows("cost")).toHaveLength(2);
      });
    });
  });

  describe("the private inbox", () => {
    it("shows a link only to its owner, and answers 404 to anybody else", async () => {
      const a = await owner();
      const b = await owner("Ben");
      entry(a);
      const { row } = offer(a);
      const mine = listSuggestions(
        ctx(),
        a.user.id,
        { status: "pending" },
        { limit: 50 },
      ).items;
      expect(mine.map((r) => r.id)).toEqual([row.id]);
      expect(
        listSuggestions(ctx(), b.user.id, { status: "pending" }, { limit: 50 })
          .items,
      ).toEqual([]);
      expect(() => getOwnSuggestion(ctx(), b.user.id, row.id)).toThrow(
        /not found/,
      );
      await expect(
        acceptSuggestion(ctx(), b.user.id, row.id, {}),
      ).rejects.toThrow(/not found/);
      expect(() => dismissSuggestion(ctx(), b.user.id, row.id)).toThrow(
        /not found/,
      );
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
    });
  });

  describe("accepting a link", () => {
    it("ties the entry to the transaction and books nothing", async () => {
      const a = await owner();
      const e = entry(a);
      const { row } = offer(a);
      const seen: string[] = [];
      const off = onEvent("financeLinksPending", (p) =>
        seen.push(p.connectionId),
      );
      const { row: accepted, entity } = await acceptSuggestion(
        ctx(),
        a.user.id,
        row.id,
        {},
      );
      off();
      expect(entity).toEqual({ type: "cost", id: e.id });
      expect(accepted).toMatchObject({
        status: "accepted",
        acceptedEntityId: e.id,
      });
      const after = getCost(ctx(), e.id);
      expect(after).toMatchObject({
        source: "manual",
        providerConnectionId: a.connection.id,
        providerRef: "tx:1",
        providerUrl: "https://finance.example.org/tx/1",
        providerLinkId: null,
        linkSyncedAt: null,
        title: "Einkauf Beispiel Markt",
      });
      expect(seen).toEqual([a.connection.id]);
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toHaveLength(
        1,
      );
    });

    it("keeps the address of the finance item off an entry somebody else made", async () => {
      const a = await owner();
      const b = await owner("Ben");
      const e = entry(a, { paidByUserId: b.user.id }, a.user.id);
      const { row } = offer(b);
      await acceptSuggestion(ctx(), b.user.id, row.id, {});
      expect(getCost(ctx(), e.id)).toMatchObject({
        providerRef: "tx:1",
        providerConnectionId: b.connection.id,
        providerUrl: null,
      });
    });

    it("is never booked a second time: the same transaction offered again changes nothing", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a);
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      const again = offer(a);
      expect(again.created).toBe(false);
      expect(again.row).toMatchObject({ kind: "link", status: "accepted" });
      expect(rows("cost")).toEqual([]);
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toHaveLength(
        1,
      );
    });

    it("answers 409 for a second accept, and takes no override", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a);
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, { title: "Anders" }),
      ).rejects.toThrow("Invalid request");
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      await expect(
        acceptSuggestion(ctx(), a.user.id, row.id, {}),
      ).rejects.toThrow(/accepted already/);
    });

    it("answers 409 when the entry is gone, tied to something else or changed, and leaves the link pending", async () => {
      const a = await owner();
      const gone = entry(a);
      const tied = entry(a, { title: "Einkauf Beispiel Markt 2" });
      const changed = entry(a, { title: "Einkauf Beispiel Markt 3" });
      const l1 = offer(a, { providerRef: "tx:1" }).row;
      const l2 = offer(a, { providerRef: "tx:2" }).row;
      const l3 = offer(a, { providerRef: "tx:3" }).row;
      // The three links point at three entries (in an order that does not matter).
      const target = (r: typeof l1) =>
        (payloadOf(r) as { entryId: string }).entryId;
      const byTarget = new Map([
        [target(l1), l1],
        [target(l2), l2],
        [target(l3), l3],
      ]);
      test.db.delete(costEntries).where(eq(costEntries.id, gone.id)).run();
      test.db
        .update(costEntries)
        .set({ providerRef: "tx:x", providerConnectionId: a.connection.id })
        .where(eq(costEntries.id, tied.id))
        .run();
      test.db
        .update(costEntries)
        .set({ amountMinor: 4300 as never })
        .where(eq(costEntries.id, changed.id))
        .run();
      for (const [id, pattern] of [
        [gone.id, /deleted/],
        [tied.id, /tied to a finance item already/],
        [changed.id, /no longer matches/],
      ] as const) {
        const link = byTarget.get(id)!;
        await expect(
          acceptSuggestion(ctx(), a.user.id, link.id, {}),
        ).rejects.toThrow(pattern);
        expect(getOwnSuggestion(ctx(), a.user.id, link.id).status).toBe(
          "pending",
        );
      }
    });
  });

  describe("dismissing a link", () => {
    it("offers the transaction as a cost after all, and leaves the entry alone", async () => {
      const a = await owner();
      const e = entry(a);
      const { row } = offer(a, { billRefs: ["b1"] });
      const dismissed = dismissSuggestion(ctx(), a.user.id, row.id);
      expect(dismissed).toMatchObject({ kind: "link", status: "dismissed" });
      const [cost] = rows("cost");
      expect(cost).toMatchObject({
        status: "pending",
        providerRef: "tx:1",
        userId: a.user.id,
        billRefsJson: ["b1"],
      });
      expect(payloadOf(cost)).toMatchObject({
        title: "BEISPIEL MARKT ZUERICH",
        amountMinor: 4250,
      });
      expect(getCost(ctx(), e.id).providerRef).toBeNull();
    });

    it("does not link the transaction again when the provider reports it again", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a);
      dismissSuggestion(ctx(), a.user.id, row.id);
      const again = offer(a, {
        payload: txPayload({ title: "BEISPIEL MARKT HB" }),
      });
      expect(again.created).toBe(false);
      expect(again.row.kind).toBe("cost");
      expect(rows("link")).toHaveLength(1);
      expect(rows("cost")).toHaveLength(1);
    });

    it("lets the cost be booked as an extra entry, and dismissing twice changes nothing", async () => {
      const a = await owner();
      const e = entry(a);
      const { row } = offer(a);
      dismissSuggestion(ctx(), a.user.id, row.id);
      expect(dismissSuggestion(ctx(), a.user.id, row.id).status).toBe(
        "dismissed",
      );
      expect(rows("cost")).toHaveLength(1);
      const [cost] = rows("cost");
      const { entity } = await acceptSuggestion(ctx(), a.user.id, cost.id, {});
      expect(entity.id).not.toBe(e.id);
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toHaveLength(
        2,
      );
    });

    it("answers 409 for an accepted link", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a);
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      expect(() => dismissSuggestion(ctx(), a.user.id, row.id)).toThrow(
        /accepted already/,
      );
    });
  });

  describe("when the entry goes away", () => {
    it("gives the transaction back as a cost when the entry is deleted, and leaves other links alone", async () => {
      const a = await owner();
      const e1 = entry(a);
      const l1 = offer(a, { providerRef: "tx:1" }).row;
      entry(a, { amountMinor: 999, title: "Anderes" });
      const l2 = offer(a, {
        providerRef: "tx:2",
        payload: txPayload({
          amountMinor: 999,
          title: "ANDERES",
          payee: null,
        }),
      }).row;
      const mine = (l: typeof l1) =>
        (payloadOf(l) as { entryId: string }).entryId;
      const [deleted, kept] = mine(l1) === e1.id ? [l1, l2] : [l2, l1];
      deleteCost(ctx(), mine(deleted) as string);
      expect(getOwnSuggestion(ctx(), a.user.id, deleted.id).status).toBe(
        "dismissed",
      );
      expect(getOwnSuggestion(ctx(), a.user.id, kept.id).status).toBe(
        "pending",
      );
      expect(rows("cost").map((r) => [r.providerRef, r.status])).toEqual([
        [deleted.providerRef, "pending"],
      ]);
    });

    it("lets an accepted link be, whatever happens to the entry", async () => {
      const a = await owner();
      const e = entry(a);
      const { row } = offer(a);
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      deleteCost(ctx(), e.id);
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe(
        "accepted",
      );
      expect(rows("cost")).toEqual([]);
    });
  });

  describe("settling a bill", () => {
    it("lists the links of transactions that name the bill, unless they were dismissed", async () => {
      const a = await owner();
      entry(a);
      const { row } = offer(a, { billRefs: ["b1"] });
      expect(
        suggestionsCoveringBill(ctx(), a.connection.id, "b1").map((s) => s.id),
      ).toEqual([row.id]);
      dismissSuggestion(ctx(), a.user.id, row.id);
      const covering = suggestionsCoveringBill(ctx(), a.connection.id, "b1");
      expect(covering.map((s) => s.kind)).toEqual(["cost"]);
    });
  });

  describe("finding suggestions for an entry being typed", () => {
    const query = (over: Record<string, unknown> = {}) => ({
      amountMinor: 4250,
      currency: "CHF",
      date: "2026-06-10",
      ...over,
    });

    it("answers the person's own pending costs with that amount and currency within three days, nearest first", async () => {
      const a = await owner();
      const b = await owner("Ben");
      offer(a, {
        providerRef: "tx:far",
        payload: txPayload({ date: "2026-06-13" }),
      });
      offer(a, {
        providerRef: "tx:same",
        payload: txPayload({ date: "2026-06-10" }),
      });
      offer(a, {
        providerRef: "tx:near",
        payload: txPayload({ date: "2026-06-09" }),
      });
      offer(a, {
        providerRef: "tx:out",
        payload: txPayload({ date: "2026-06-14" }),
      });
      offer(a, {
        providerRef: "tx:amount",
        payload: txPayload({ amountMinor: 4251 }),
      });
      offer(a, {
        providerRef: "tx:eur",
        payload: txPayload({ currency: "EUR" }),
      });
      offer(a, {
        providerRef: "tx:refund",
        payload: txPayload({ amountMinor: -4250 }),
      });
      offer(a, { providerRef: "tx:done", payload: txPayload() }, "dismissed");
      offer(b, { providerRef: "tx:theirs" });
      expect(
        matchingCostSuggestions(ctx(), a.user.id, query()).map(
          (r) => r.providerRef,
        ),
      ).toEqual(["tx:same", "tx:near", "tx:far"]);
      expect(
        matchingCostSuggestions(ctx(), b.user.id, query()).map(
          (r) => r.providerRef,
        ),
      ).toEqual(["tx:theirs"]);
    });

    it("leaves out links, assets and accepted costs", async () => {
      const a = await owner();
      const { row } = offer(a, { providerRef: "tx:1" });
      await acceptSuggestion(ctx(), a.user.id, row.id, {});
      offer(a, {
        providerRef: "tx:a",
        kind: "asset",
        payload: {
          name: "Herd",
          purchaseDate: "2026-06-10",
          priceMinor: 4250,
          currency: "CHF",
          url: null,
        },
      });
      entry(a, { date: "2026-06-11" });
      offer(a, { providerRef: "tx:l" });
      expect(rows("link")).toHaveLength(1);
      expect(matchingCostSuggestions(ctx(), a.user.id, query())).toEqual([]);
    });
  });

  describe("tying an entry made by hand to a suggestion", () => {
    it("books the entry with the transaction in one step, and accepts the suggestion", async () => {
      const a = await owner();
      const { row } = offer(a);
      const seen: string[] = [];
      const off = onEvent("financeLinksPending", (p) =>
        seen.push(p.connectionId),
      );
      const e = createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Einkauf",
          amountMinor: 4250,
          category: "groceries",
          date: "2026-06-11",
          financeSuggestionId: row.id,
          splitMode: "none",
        }),
        a.user.id,
      );
      off();
      expect(e).toMatchObject({
        source: "manual",
        providerConnectionId: a.connection.id,
        providerRef: "tx:1",
        providerUrl: "https://finance.example.org/tx/1",
        title: "Einkauf",
      });
      expect(getOwnSuggestion(ctx(), a.user.id, row.id)).toMatchObject({
        status: "accepted",
        acceptedEntityId: e.id,
      });
      expect(seen).toEqual([a.connection.id]);
      // The transaction is booked: it is not offered again.
      expect(offer(a).created).toBe(false);
    });

    it("books nothing and leaves the suggestion pending when the entry is refused", async () => {
      const a = await owner();
      const { row } = offer(a);
      expect(() =>
        createCost(
          ctx(),
          createCostRequestSchema.parse({
            title: "Einkauf",
            amountMinor: 4250,
            category: "groceries",
            financeSuggestionId: row.id,
            tagIds: ["nope"],
            splitMode: "none",
          }),
          a.user.id,
        ),
      ).toThrow("Invalid request");
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
      expect(listCosts(ctx(), {}, { limit: 10 }, a.user.id).items).toEqual([]);
    });

    it.each<[string, Record<string, unknown>, RegExp | string]>([
      ["another amount", { amountMinor: 4251 }, "Invalid request"],
      ["another currency", { currency: "EUR" }, "Invalid request"],
    ])("refuses %s", async (_name, over, message) => {
      const a = await owner();
      const { row } = offer(a);
      expect(() =>
        createCost(
          ctx(),
          createCostRequestSchema.parse({
            title: "Einkauf",
            amountMinor: 4250,
            category: "groceries",
            financeSuggestionId: row.id,
            splitMode: "none",
            ...over,
          }),
          a.user.id,
        ),
      ).toThrow(message);
      expect(getOwnSuggestion(ctx(), a.user.id, row.id).status).toBe("pending");
    });

    it("answers 404 for a suggestion that is not the person's own or does not exist, and 400/409 for the wrong kind or state", async () => {
      const a = await owner();
      const b = await owner("Ben");
      const { row: theirs } = offer(b);
      const { row: asset } = offer(a, {
        providerRef: "tx:a",
        kind: "asset",
        payload: {
          name: "Herd",
          purchaseDate: "2026-06-10",
          priceMinor: 4250,
          currency: "CHF",
          url: null,
        },
      });
      const { row: done } = offer(a, { providerRef: "tx:done" });
      dismissSuggestion(ctx(), a.user.id, done.id);
      const make = (
        financeSuggestionId: string,
        by: string | null = a.user.id,
      ) =>
        createCost(
          ctx(),
          createCostRequestSchema.parse({
            title: "Einkauf",
            amountMinor: 4250,
            category: "groceries",
            financeSuggestionId,
            splitMode: "none",
          }),
          by,
        );
      expect(() => make(theirs.id)).toThrow(/not found/);
      expect(() => make("nope")).toThrow(/not found/);
      expect(() => make(theirs.id, null)).toThrow(/not found/);
      expect(() => make(asset.id)).toThrow("Invalid request");
      expect(() => make(done.id)).toThrow(/dismissed/);
      expect(getOwnSuggestion(ctx(), b.user.id, theirs.id).status).toBe(
        "pending",
      );
    });

    it("ties an existing entry, checking the amount it has after the change, and releases other links to it", async () => {
      const a = await owner();
      const e = entry(a, { title: "Etwas ganz anderes", amountMinor: 4000 });
      const { row } = offer(a, { providerRef: "tx:1" });
      const patch = (p: Record<string, unknown>) =>
        updateCost(ctx(), e.id, updateCostRequestSchema.parse(p), {
          userId: a.user.id,
        });
      expect(() => patch({ financeSuggestionId: row.id })).toThrow(
        "Invalid request",
      );
      const tied = patch({ financeSuggestionId: row.id, amountMinor: 4250 });
      expect(tied).toMatchObject({
        providerRef: "tx:1",
        providerConnectionId: a.connection.id,
        providerLinkId: null,
        amountMinor: 4250,
        providerUrl: "https://finance.example.org/tx/1",
      });
      expect(getOwnSuggestion(ctx(), a.user.id, row.id)).toMatchObject({
        status: "accepted",
        acceptedEntityId: e.id,
      });
    });

    it("answers 409 for an entry tied to another item, and does nothing for a repeated request", async () => {
      const a = await owner();
      const e = entry(a, { title: "Anderer Name" });
      const { row: first } = offer(a, { providerRef: "tx:1" });
      const { row: second } = offer(a, { providerRef: "tx:2" });
      const patch = (id: string) =>
        updateCost(
          ctx(),
          e.id,
          updateCostRequestSchema.parse({ financeSuggestionId: id }),
          { userId: a.user.id },
        );
      patch(first.id);
      const again = patch(first.id);
      expect(again.providerRef).toBe("tx:1");
      expect(() => patch(second.id)).toThrow(/tied to a finance item already/);
      expect(getOwnSuggestion(ctx(), a.user.id, second.id).status).toBe(
        "pending",
      );
    });

    it("lets go of a link to the entry when the entry is tied to another transaction", async () => {
      const a = await owner();
      const e = entry(a);
      const link = offer(a, { providerRef: "tx:1" }).row;
      expect(link.kind).toBe("link");
      const other = offer(a, {
        providerRef: "tx:2",
        payload: txPayload({ title: "Zufall", payee: null }),
      }).row;
      expect(other.kind).toBe("cost");
      updateCost(
        ctx(),
        e.id,
        updateCostRequestSchema.parse({ financeSuggestionId: other.id }),
        { userId: a.user.id },
      );
      expect(getOwnSuggestion(ctx(), a.user.id, link.id).status).toBe(
        "dismissed",
      );
      expect(
        rows("cost")
          .map((r) => [r.providerRef, r.status])
          .sort(),
      ).toEqual([
        ["tx:1", "pending"],
        ["tx:2", "accepted"],
      ]);
    });

    it("changes nothing when the suggestion is not the person's own", async () => {
      const a = await owner();
      const b = await owner("Ben");
      const e = entry(a, { title: "Anderer Name" });
      const { row } = offer(b);
      expect(() =>
        updateCost(
          ctx(),
          e.id,
          updateCostRequestSchema.parse({ financeSuggestionId: row.id }),
          { userId: a.user.id },
        ),
      ).toThrow(/not found/);
      expect(() =>
        updateCost(
          ctx(),
          e.id,
          updateCostRequestSchema.parse({ financeSuggestionId: row.id }),
        ),
      ).toThrow(/not found/);
      expect(getCost(ctx(), e.id).providerRef).toBeNull();
    });
  });

  it("carries tags a person chose when accepting a cost", async () => {
    const a = await owner();
    const tag = createCostTag(ctx(), { name: "Ferien" });
    const { row } = offer(a);
    expect(row.kind).toBe("cost");
    const { entity } = await acceptSuggestion(ctx(), a.user.id, row.id, {
      tagIds: [tag.id],
    });
    expect(getCost(ctx(), entity.id).tags.map((t) => t.name)).toEqual([
      "Ferien",
    ]);
  });
});
