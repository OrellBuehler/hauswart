import { and, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type {
  MoveCostsToBookRequest,
  MoveCostsToBookResult,
} from "$lib/api/schemas/costs";
import { assets, costEntries } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";
import { requireOpenCostBook } from "./books";

/**
 * Moves cost entries into another book, all or nothing: the entries in `ids`, or every entry of the device `assetId`.
 * Only the ledger changes. The split, the payer and the frozen shares stay, so what each person bears stays too; the
 * entry now counts in the other book's summary, balances and CSV. An entry booked by a fuel log entry may move, since
 * the fill owns its amount, currency, date and device only. A book that is not tax relevant has no tax class, so a class
 * other than `unknown` is reset (`deductibleReset`), as a move through `updateCost` does it.
 *
 * Throws a 400 on `bookId` for a book that does not exist or is archived, on `ids` for an id that does not exist (and
 * nothing moves) and on `assetId` for a device that does not exist.
 *
 * With `dryRun` it does everything except write: the same checks, the same counts, and `years` (the first and last year
 * of the entries that would move), so a person can see what a move of a whole device touches before confirming it.
 */
export function moveCostsToBook(
  ctx: ServiceContext,
  input: MoveCostsToBookRequest,
): MoveCostsToBookResult {
  const book = requireOpenCostBook(ctx, input.bookId);
  const ids = input.ids ? [...new Set(input.ids)] : undefined;
  if (ids === undefined && input.assetId !== undefined) {
    const asset = ctx.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .get();
    if (!asset) throw invalidField("assetId", "Asset does not exist");
  }
  const dryRun = input.dryRun === true;
  const scope: SQL =
    ids !== undefined
      ? inArray(costEntries.id, ids)
      : eq(costEntries.assetId, input.assetId as string);

  return ctx.db.transaction((tx) => {
    const total =
      tx.select({ n: count() }).from(costEntries).where(scope).get()?.n ?? 0;
    if (ids !== undefined && total !== ids.length) {
      throw invalidField(
        "ids",
        `${ids.length - total} of the cost entries do not exist`,
      );
    }
    const elsewhere = and(scope, ne(costEntries.bookId, book.id)) as SQL;
    const moving =
      tx.select({ n: count() }).from(costEntries).where(elsewhere).get()?.n ??
      0;
    let deductibleReset = 0;
    let years: MoveCostsToBookResult["years"] = null;
    if (moving > 0) {
      const span = tx
        .select({
          first: sql<string>`min(substr(${costEntries.date}, 1, 4))`,
          last: sql<string>`max(substr(${costEntries.date}, 1, 4))`,
        })
        .from(costEntries)
        .where(elsewhere)
        .get();
      if (span) years = { from: Number(span.first), to: Number(span.last) };
      if (!book.taxRelevant) {
        const classified = and(
          elsewhere,
          ne(costEntries.deductible, "unknown"),
        ) as SQL;
        deductibleReset =
          tx.select({ n: count() }).from(costEntries).where(classified).get()
            ?.n ?? 0;
        if (deductibleReset > 0 && !dryRun) {
          tx.update(costEntries)
            .set({ deductible: "unknown" })
            .where(classified)
            .run();
        }
      }
      if (!dryRun) {
        tx.update(costEntries).set({ bookId: book.id }).where(elsewhere).run();
      }
    }
    return {
      bookId: book.id,
      moved: moving,
      unchanged: total - moving,
      deductibleReset,
      dryRun,
      years,
    };
  });
}
