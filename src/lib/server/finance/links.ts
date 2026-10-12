import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  costSuggestionPayloadSchema,
  storedLinkPayloadSchema,
} from "$lib/api/schemas/finance";
import {
  MATCH_DAYS,
  MATCH_MIN_SIMILARITY,
  matchSimilarity,
  transactionMatchesEntry,
  type MatchSide,
} from "$lib/costs/match";
import { addDays, diffDays } from "$lib/dates";
import {
  costBooks,
  costEntries,
  financeSuggestions,
  type DB,
} from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import {
  findSuggestion,
  getOwnSuggestion,
  markAccepted,
  payloadOf,
  type SuggestionRow,
} from "./store";

/**
 * Ties cost entries to transactions of a finance system without booking anything twice. Everything here works on the
 * tables alone (no cost or suggestion service), so the cost service can use it.
 */
type Db = Pick<ServiceContext, "db">;

export type CostPayload = z.output<typeof costSuggestionPayloadSchema>;
export type StoredLinkPayload = z.output<typeof storedLinkPayloadSchema>;
type EntryRow = typeof costEntries.$inferSelect;

/** What the facts of an entry look like to the matching rule. */
const entrySide = (e: EntryRow): MatchSide => ({
  amountMinor: e.amountMinor,
  currency: e.currency,
  date: e.date,
  title: e.title,
  payee: e.payee,
});

const transactionSide = (t: CostPayload): MatchSide => ({
  amountMinor: t.amountMinor,
  currency: t.currency,
  date: t.date,
  title: t.title,
  payee: t.payee,
});

/** The sources of an entry a transaction can be tied to: made by a person or by a recurring cost, never booked from a finance item. */
const LINKABLE_SOURCES = ["manual", "recurring"] as const;

/**
 * The entry a transaction offered to `userId` most likely is, if any (see `transactionMatchesEntry` for the rule): same
 * amount and currency, booked by hand or by a recurring cost, paid by that person, not tied to a finance item and not
 * the target of another pending link, dated at most 3 days from the transaction, with similar text. With several the
 * most similar text wins, then the nearer date, then the entry made first.
 */
export function findMatchingEntry(
  ctx: Db,
  userId: string,
  transaction: CostPayload,
): EntryRow | undefined {
  const candidates = ctx.db
    .select()
    .from(costEntries)
    .where(
      and(
        eq(costEntries.amountMinor, transaction.amountMinor as never),
        eq(costEntries.currency, transaction.currency),
        eq(costEntries.paidByUserId, userId),
        gte(costEntries.date, addDays(transaction.date, -MATCH_DAYS)),
        lte(costEntries.date, addDays(transaction.date, MATCH_DAYS)),
        inArray(costEntries.source, [...LINKABLE_SOURCES]),
        isNull(costEntries.providerRef),
        isNull(costEntries.providerConnectionId),
        sql`not exists (select 1 from finance_suggestions where finance_suggestions.kind = 'link' and finance_suggestions.status = 'pending' and json_extract(finance_suggestions.payload_json, '$.entryId') = cost_entries.id)`,
      ),
    )
    .all();
  const tx = transactionSide(transaction);
  return candidates
    .map((entry) => ({
      entry,
      score: matchSimilarity(entrySide(entry), tx),
      days: Math.abs(diffDays(entry.date, transaction.date)),
    }))
    .filter((c) => c.score >= MATCH_MIN_SIMILARITY)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.days - b.days ||
        a.entry.createdAt.getTime() - b.entry.createdAt.getTime() ||
        a.entry.id.localeCompare(b.entry.id),
    )[0]?.entry;
}

/** Whether a pending link points at the entry already. */
function isLinkTarget(ctx: Db, entryId: string): boolean {
  return (
    ctx.db
      .select({ id: financeSuggestions.id })
      .from(financeSuggestions)
      .where(
        and(
          eq(financeSuggestions.kind, "link"),
          eq(financeSuggestions.status, "pending"),
          sql`json_extract(${financeSuggestions.payloadJson}, '$.entryId') = ${entryId}`,
        ),
      )
      .get() !== undefined
  );
}

/**
 * The other direction of `findMatchingEntry`: an entry was just booked (by hand without naming a transaction, or by a
 * recurring cost) while the transaction it stands for was already waiting as a cost suggestion. When exactly one pending
 * cost suggestion of the entry's payer matches it (`transactionMatchesEntry`), that suggestion becomes a `link` to the
 * entry in place (same id, connection, reference, bill references and position in the inbox), so accepting it ties the two
 * and the expense is not booked a second time. Nothing is accepted: a person decides. Several fitting offers are
 * ambiguous and change nothing, and neither does a transaction that has a link row already (turned down before, or
 * accepted): its reference is unique among links. Runs in the booking's transaction (`db`), so a booking that is rolled
 * back leaves the offer as it was. Answers the new link, or undefined.
 */
export function linkWaitingOffer(
  ctx: Db,
  entry: EntryRow,
): SuggestionRow | undefined {
  if (
    entry.paidByUserId === null ||
    entry.providerRef !== null ||
    entry.providerConnectionId !== null ||
    !(LINKABLE_SOURCES as readonly string[]).includes(entry.source)
  ) {
    return undefined;
  }
  const field = (name: string) =>
    sql`json_extract(${financeSuggestions.payloadJson}, ${`$.${name}`})`;
  const hits = ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.userId, entry.paidByUserId),
        eq(financeSuggestions.kind, "cost"),
        eq(financeSuggestions.status, "pending"),
        sql`${field("amountMinor")} = ${entry.amountMinor}`,
        sql`${field("currency")} = ${entry.currency}`,
        sql`${field("date")} >= ${addDays(entry.date, -MATCH_DAYS)}`,
        sql`${field("date")} <= ${addDays(entry.date, MATCH_DAYS)}`,
      ),
    )
    .all()
    .flatMap((row) => {
      const parsed = costSuggestionPayloadSchema.safeParse(row.payloadJson);
      return parsed.success &&
        transactionMatchesEntry(entrySide(entry), transactionSide(parsed.data))
        ? [{ row, transaction: parsed.data }]
        : [];
    });
  if (hits.length !== 1) return undefined;
  const [{ row, transaction }] = hits;
  if (
    findSuggestion(ctx, row.connectionId, "link", row.providerRef) ||
    isLinkTarget(ctx, entry.id)
  ) {
    return undefined;
  }
  const payload: StoredLinkPayload = { entryId: entry.id, transaction };
  return ctx.db
    .update(financeSuggestions)
    .set({ kind: "link", payloadJson: payload })
    .where(
      and(
        eq(financeSuggestions.id, row.id),
        eq(financeSuggestions.kind, "cost"),
        eq(financeSuggestions.status, "pending"),
      ),
    )
    .returning()
    .get();
}

export function insertLinkSuggestion(
  ctx: Db,
  input: {
    connectionId: string;
    userId: string;
    providerRef: string;
    entryId: string;
    transaction: CostPayload;
    billRefs: string[];
  },
): SuggestionRow {
  const payload: StoredLinkPayload = {
    entryId: input.entryId,
    transaction: input.transaction,
  };
  return ctx.db
    .insert(financeSuggestions)
    .values({
      connectionId: input.connectionId,
      userId: input.userId,
      kind: "link",
      providerRef: input.providerRef,
      payloadJson: payload,
      billRefsJson: input.billRefs,
    })
    .returning()
    .get();
}

/** The transaction of a link suggestion offered as a cost again, unless it is a cost suggestion already. */
function restoreCostOffer(ctx: Db, link: SuggestionRow): void {
  if (findSuggestion(ctx, link.connectionId, "cost", link.providerRef)) return;
  const { transaction } = payloadOf(link) as StoredLinkPayload;
  ctx.db
    .insert(financeSuggestions)
    .values({
      connectionId: link.connectionId,
      userId: link.userId,
      kind: "cost",
      providerRef: link.providerRef,
      payloadJson: transaction,
      billRefsJson: link.billRefsJson,
    })
    .run();
}

/**
 * Turns a pending link down: it is dismissed and its transaction comes back as a normal cost suggestion, since "this is
 * not that entry" does not mean "ignore the transaction". Nothing about the entry changes.
 */
export function dismissLink(ctx: Db, link: SuggestionRow): SuggestionRow {
  const row = ctx.db
    .update(financeSuggestions)
    .set({ status: "dismissed" })
    .where(eq(financeSuggestions.id, link.id))
    .returning()
    .get();
  restoreCostOffer(ctx, link);
  return row;
}

/** Lets go of every pending link that points at the entry (it was deleted, or tied to another item). */
export function releaseLinks(ctx: Db, entryId: string): void {
  const links = ctx.db
    .select()
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.kind, "link"),
        eq(financeSuggestions.status, "pending"),
        sql`json_extract(${financeSuggestions.payloadJson}, '$.entryId') = ${entryId}`,
      ),
    )
    .all();
  for (const link of links) dismissLink(ctx, link);
}

/**
 * Accepting a link: the entry remembers the transaction (so it is never booked twice and the finance app gets its
 * back-link), nothing new is booked. It must still be the entry it was offered for: there, not tied to anything else and
 * with the transaction's amount and currency (409 otherwise; dismiss the link to get the transaction back as a cost). The
 * address of the item in the finance app is kept only on an entry its owner made, since only its maker sees it.
 */
export function acceptLink(
  ctx: ServiceContext,
  row: SuggestionRow,
): { row: SuggestionRow; entryId: string } {
  const { entryId, transaction } = payloadOf(row) as StoredLinkPayload;
  const entry = ctx.db
    .select()
    .from(costEntries)
    .where(eq(costEntries.id, entryId))
    .get();
  if (!entry) {
    throw conflict(
      "The cost entry was deleted; dismiss this suggestion to get the transaction back as a cost",
    );
  }
  if (entry.providerRef !== null || entry.providerConnectionId !== null) {
    throw conflict("This cost entry is tied to a finance item already");
  }
  if (
    entry.amountMinor !== transaction.amountMinor ||
    entry.currency !== transaction.currency
  ) {
    throw conflict(
      "The amount of the cost entry changed and no longer matches the transaction; dismiss this suggestion to get the transaction back as a cost",
    );
  }
  let accepted: SuggestionRow;
  try {
    accepted = ctx.db.transaction((tx) => {
      tx.update(costEntries)
        .set({
          providerConnectionId: row.connectionId,
          providerRef: row.providerRef,
          providerUrl: entry.createdBy === row.userId ? transaction.url : null,
          providerLinkId: null,
          linkSyncedAt: null,
        })
        .where(eq(costEntries.id, entryId))
        .run();
      return markAccepted({ db: tx as unknown as DB }, row.id, entryId);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("This item of the finance provider is already booked");
    }
    throw err;
  }
  emitEvent("financeLinksPending", { ctx, connectionId: row.connectionId });
  return { row: accepted, entryId };
}

/** What an entry that is tied to a suggestion remembers about it. */
export interface TiedOrigin {
  connectionId: string;
  ref: string;
  url: string | null;
}

/**
 * Checks that the caller's own suggestion can be tied to an entry with these facts, and answers what the entry then
 * remembers: a 404 for a suggestion that is not the caller's, a 400 on `financeSuggestionId` for one that is not a cost
 * or has another amount or currency, a 409 for one that is decided already. Nothing is written; the caller books the
 * entry and then calls `tieSuggestion`, in one transaction.
 */
export function claimSuggestion(
  ctx: Db,
  userId: string | null,
  suggestionId: string,
  entry: { amountMinor: number; currency: string; createdBy: string | null },
): { origin: TiedOrigin } {
  if (userId === null) throw notFound("Suggestion");
  const row = getOwnSuggestion(ctx, userId, suggestionId);
  if (row.kind !== "cost") {
    throw invalidField(
      "financeSuggestionId",
      "Only a suggestion of a cost can be tied to a cost entry",
    );
  }
  if (row.status !== "pending") {
    throw conflict(
      row.status === "accepted"
        ? "This suggestion was accepted already"
        : "This suggestion was dismissed",
    );
  }
  const payload = payloadOf(row) as CostPayload;
  if (
    payload.amountMinor !== entry.amountMinor ||
    payload.currency !== entry.currency
  ) {
    throw invalidField(
      "financeSuggestionId",
      "The amount or currency of the entry differs from the transaction's",
    );
  }
  return {
    origin: {
      connectionId: row.connectionId,
      ref: row.providerRef,
      url: entry.createdBy === row.userId ? payload.url : null,
    },
  };
}

/** Whether the caller's suggestion was already accepted for exactly this entry (a repeated request). */
export function isTiedTo(
  ctx: Db,
  userId: string,
  suggestionId: string,
  entryId: string,
): boolean {
  const row = ctx.db
    .select({
      status: financeSuggestions.status,
      acceptedEntityId: financeSuggestions.acceptedEntityId,
    })
    .from(financeSuggestions)
    .where(
      and(
        eq(financeSuggestions.id, suggestionId),
        eq(financeSuggestions.userId, userId),
      ),
    )
    .get();
  return row?.status === "accepted" && row.acceptedEntityId === entryId;
}

/**
 * Marks the suggestion as booked as this entry, and lets other links to the entry go. Only a suggestion that is still
 * pending is taken: one that was decided since `claimSuggestion` looked at it (the write is guarded by the status, not
 * by that earlier read) is a 409 and, in the caller's transaction, rolls the entry back with it.
 */
export function tieSuggestion(
  ctx: Db,
  suggestionId: string,
  entryId: string,
): void {
  const tied = ctx.db
    .update(financeSuggestions)
    .set({ status: "accepted", acceptedEntityId: entryId })
    .where(
      and(
        eq(financeSuggestions.id, suggestionId),
        eq(financeSuggestions.status, "pending"),
      ),
    )
    .returning({ id: financeSuggestions.id })
    .all();
  if (tied.length !== 1) {
    throw conflict("This suggestion was decided meanwhile");
  }
  releaseLinks(ctx, entryId);
}

export interface LinkedEntrySummary {
  id: string;
  title: string;
  date: string;
  amountMinor: number;
  currency: string;
  payee: string | null;
  bookId: string;
  bookName: string;
}

/** The entries link suggestions point at, as they are now; one that was deleted has no key. */
export function linkedEntries(
  ctx: Db,
  ids: readonly string[],
): Map<string, LinkedEntrySummary> {
  const out = new Map<string, LinkedEntrySummary>();
  if (ids.length === 0) return out;
  const rows = ctx.db
    .select({
      id: costEntries.id,
      title: costEntries.title,
      date: costEntries.date,
      amountMinor: costEntries.amountMinor,
      currency: costEntries.currency,
      payee: costEntries.payee,
      bookId: costEntries.bookId,
      bookName: costBooks.name,
    })
    .from(costEntries)
    .innerJoin(costBooks, eq(costBooks.id, costEntries.bookId))
    .where(inArray(costEntries.id, [...ids]))
    .orderBy(asc(costEntries.id))
    .all();
  for (const r of rows) out.set(r.id, r);
  return out;
}
