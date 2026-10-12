import { asc, count, desc, eq, sql } from "drizzle-orm";
import { RECENT_CATEGORY_ENTRIES } from "$lib/api/schemas/costs";
import type { CostCategory } from "$lib/api/enums";
import { costBooks, costEntries } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { getCostBookRow } from "./books";

type Db = Pick<ServiceContext, "db">;

export interface RecentCategory {
  bookId: string;
  category: CostCategory;
  count: number;
}

/**
 * Which categories the newest entries of each book (or of one book) used, and how often: what a form needs to put the
 * likely categories first, without reading a hundred whole entries. "Newest" is the order of the list (date, then when the
 * entry was made); every entry counts, refunds and other currencies too. A `bookId` that names no book is a 404.
 */
export function recentCategories(
  ctx: Db,
  filter: { bookId?: string | undefined },
  options: { entries?: number } = {},
): { entriesPerBook: number; items: RecentCategory[] } {
  const entries = options.entries ?? RECENT_CATEGORY_ENTRIES;
  const bookIds = filter.bookId
    ? [getCostBookRow(ctx, filter.bookId).id]
    : ctx.db
        .select({ id: costBooks.id })
        .from(costBooks)
        .orderBy(asc(costBooks.sortOrder), asc(costBooks.createdAt))
        .all()
        .map((row) => row.id);
  const items: RecentCategory[] = [];
  for (const bookId of bookIds) {
    const newest = ctx.db
      .select({ category: costEntries.category })
      .from(costEntries)
      .where(eq(costEntries.bookId, bookId))
      .orderBy(
        desc(costEntries.date),
        desc(costEntries.createdAt),
        desc(sql`${costEntries}.rowid`),
      )
      .limit(entries)
      .as("newest");
    const rows = ctx.db
      .select({ category: newest.category, n: count() })
      .from(newest)
      .groupBy(newest.category)
      .all();
    rows.sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
    for (const row of rows) {
      items.push({ bookId, category: row.category, count: row.n });
    }
  }
  return { entriesPerBook: entries, items };
}
