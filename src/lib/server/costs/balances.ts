import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { CostBalances } from "$lib/api/schemas/costs";
import {
  costEntries,
  costEntryShares,
  settlements,
  users,
} from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { getCostBookRow } from "./books";
import { bookEntry, bookSettlement, newLedger, personBalances } from "./ledger";
import type { Share } from "./split";
import { settle } from "./summary";

type Db = Pick<ServiceContext, "db">;

/** The recorded payments across all books (household currency), which the view of one book leaves out. */
function crossBookSettlements(ctx: Db, currency: string) {
  const row = ctx.db
    .select({
      count: count(),
      total: sql<number | null>`sum(${settlements.amountMinor})`,
    })
    .from(settlements)
    .where(and(isNull(settlements.bookId), eq(settlements.currency, currency)))
    .get();
  return { count: row?.count ?? 0, totalMinor: Number(row?.total ?? 0) };
}

/**
 * Where everybody stands, all time: each person's `paid - share` over the split entries with a payer, plus the payments
 * they handed over (settlements) minus those they received. Positive means the others owe this person. Only the household
 * currency is counted (`otherCurrencyCount` says how many entries and payments were left out).
 *
 * With a `bookId` the numbers are that book's alone, payments across all books excluded (they cannot be attributed to
 * one book): their number and total are `crossBookSettlements`, so a view of one book can say what it leaves out. Without,
 * every book counts, archived ones too (money owed does not vanish with the book) and so do payments across all books.
 * `suggestedPayments` are the fewest-first payments that would square the balances.
 */
export function costBalances(
  ctx: Db,
  filter: { bookId?: string } = {},
): CostBalances {
  const { currency } = getHousehold(ctx);
  const book = filter.bookId ? getCostBookRow(ctx, filter.bookId) : undefined;

  const entryScope = filter.bookId
    ? eq(costEntries.bookId, filter.bookId)
    : undefined;
  const entries = ctx.db
    .select({
      id: costEntries.id,
      amountMinor: costEntries.amountMinor,
      currency: costEntries.currency,
      splitMode: costEntries.splitMode,
      paidByUserId: costEntries.paidByUserId,
    })
    .from(costEntries)
    .where(entryScope)
    .all();
  const sharesByEntry = new Map<string, Share[]>();
  for (const s of ctx.db
    .select({
      entryId: costEntryShares.entryId,
      userId: costEntryShares.userId,
      shareBps: costEntryShares.shareBps,
    })
    .from(costEntryShares)
    .innerJoin(costEntries, eq(costEntries.id, costEntryShares.entryId))
    .where(entryScope)
    .all()) {
    sharesByEntry.set(s.entryId, [
      ...(sharesByEntry.get(s.entryId) ?? []),
      { userId: s.userId, shareBps: s.shareBps },
    ]);
  }
  const payments = ctx.db
    .select({
      fromUserId: settlements.fromUserId,
      toUserId: settlements.toUserId,
      amountMinor: settlements.amountMinor,
      currency: settlements.currency,
    })
    .from(settlements)
    .where(filter.bookId ? eq(settlements.bookId, filter.bookId) : undefined)
    .all();

  const ledger = newLedger();
  let otherCurrency = 0;
  for (const e of entries) {
    if (e.currency !== currency) {
      otherCurrency++;
      continue;
    }
    bookEntry(ledger, e, sharesByEntry.get(e.id) ?? []);
  }
  for (const p of payments) {
    if (p.currency !== currency) {
      otherCurrency++;
      continue;
    }
    bookSettlement(ledger, p);
  }

  const people = ctx.db
    .select({
      id: users.id,
      name: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(users)
    .all();
  const rows = personBalances(ledger, people);
  const nameOf = new Map(rows.map((p) => [p.userId, p.userName]));
  return {
    book: book ? { id: book.id, name: book.name } : null,
    currency,
    otherCurrencyCount: otherCurrency,
    unassignedPayerCount: ledger.unassigned,
    crossBookSettlements: book ? crossBookSettlements(ctx, currency) : null,
    people: rows,
    suggestedPayments: settle(rows).map((t) => ({
      fromUserId: t.fromUserId,
      fromName: nameOf.get(t.fromUserId) ?? null,
      toUserId: t.toUserId,
      toName: nameOf.get(t.toUserId) ?? null,
      amountMinor: t.amountMinor,
    })),
  };
}
