import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type {
  CreateCostBookRequest,
  ListCostBooksQuery,
  UpdateCostBookRequest,
} from "$lib/api/schemas/cost-books";
import { costBooks } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { slugify, uniqueSlug } from "$lib/server/slug";

type Db = Pick<ServiceContext, "db">;

export type CostBookRow = typeof costBooks.$inferSelect;

export interface CostBookRecord extends CostBookRow {
  isDefault: boolean;
  entryCount: number;
  settlementCount: number;
}

const ordering = [
  asc(sql`${costBooks.archivedAt} is not null`),
  asc(costBooks.sortOrder),
  asc(costBooks.createdAt),
  asc(costBooks.id),
];

const firstOpen = (ctx: Db) =>
  ctx.db
    .select()
    .from(costBooks)
    .where(isNull(costBooks.archivedAt))
    .orderBy(...ordering)
    .limit(1)
    .get();

/**
 * The book an entry or a settlement goes to when the request names none: the first one that is not archived, by sort
 * order. There is always one, because the last active book can be neither archived nor deleted.
 */
export function defaultCostBook(ctx: Db): CostBookRow {
  const book = firstOpen(ctx);
  if (!book) {
    throw invalidField(
      "bookId",
      "There is no cost book that accepts entries; create or restore one",
    );
  }
  return book;
}

export function findCostBookRow(ctx: Db, id: string): CostBookRow | undefined {
  return ctx.db.select().from(costBooks).where(eq(costBooks.id, id)).get();
}

/** A book a request points at; a missing one is a 400 on the field that named it. */
export function requireCostBook(
  ctx: Db,
  id: string,
  field = "bookId",
): CostBookRow {
  const book = findCostBookRow(ctx, id);
  if (!book) throw invalidField(field, "Cost book does not exist");
  return book;
}

/** A book that takes new entries (not archived), named by a request. */
export function requireOpenCostBook(
  ctx: Db,
  id: string,
  field = "bookId",
): CostBookRow {
  const book = requireCostBook(ctx, id, field);
  if (book.archivedAt !== null) {
    throw invalidField(
      field,
      "This cost book is archived; restore it to book into it",
    );
  }
  return book;
}

/** Qualified by hand: drizzle leaves the table off a column in a select over one table, and `id` would then bind to the subquery's own. */
const entryCountSql = sql<number>`(select count(*) from cost_entries where cost_entries.book_id = cost_books.id)`;
const settlementCountSql = sql<number>`(select count(*) from settlements where settlements.book_id = cost_books.id)`;

function select(ctx: Db) {
  return ctx.db
    .select({
      book: costBooks,
      entryCount: entryCountSql,
      settlementCount: settlementCountSql,
    })
    .from(costBooks);
}

function recordOf(
  row: ReturnType<ReturnType<typeof select>["all"]>[number],
  defaultId: string | undefined,
): CostBookRecord {
  return {
    ...row.book,
    isDefault: row.book.id === defaultId,
    entryCount: Number(row.entryCount),
    settlementCount: Number(row.settlementCount),
  };
}

export function listCostBooks(
  ctx: Db,
  filter: Pick<ListCostBooksQuery, "includeArchived">,
  page: { cursor?: string; limit: number },
) {
  const rows = select(ctx)
    .where(filter.includeArchived ? undefined : isNull(costBooks.archivedAt))
    .orderBy(...ordering)
    .all();
  const first = firstOpen(ctx)?.id;
  return paginateArray(
    rows.map((row) => recordOf(row, first)),
    page.cursor,
    page.limit,
  );
}

export function findCostBook(ctx: Db, id: string): CostBookRecord | undefined {
  const row = select(ctx).where(eq(costBooks.id, id)).get();
  return row ? recordOf(row, firstOpen(ctx)?.id) : undefined;
}

export function getCostBook(ctx: Db, id: string): CostBookRecord {
  const book = findCostBook(ctx, id);
  if (!book) throw notFound("Cost book");
  return book;
}

const slugTaken = (ctx: Db, slug: string) =>
  ctx.db
    .select({ id: costBooks.id })
    .from(costBooks)
    .where(eq(costBooks.slug, slug))
    .get() !== undefined;

/** Names are compared without regard to case, so "auto" cannot join an "Auto" a picker would show twice. */
function nameTaken(ctx: Db, name: string, exceptId?: string): boolean {
  const same = sql`lower(${costBooks.name}) = lower(${name})`;
  return (
    ctx.db
      .select({ id: costBooks.id })
      .from(costBooks)
      .where(exceptId ? and(same, sql`${costBooks.id} <> ${exceptId}`) : same)
      .get() !== undefined
  );
}

const activeCount = (ctx: Db) =>
  ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(costBooks)
    .where(isNull(costBooks.archivedAt))
    .get()?.n ?? 0;

export function createCostBook(
  ctx: Db,
  input: CreateCostBookRequest,
): CostBookRecord {
  if (nameTaken(ctx, input.name)) {
    throw conflict("A cost book with this name already exists");
  }
  const slug =
    input.slug ??
    uniqueSlug(slugify(input.name), (candidate) => slugTaken(ctx, candidate));
  if (input.slug && slugTaken(ctx, slug)) {
    throw conflict("A cost book with this slug already exists");
  }
  const next =
    (ctx.db
      .select({ m: sql<number | null>`max(${costBooks.sortOrder})` })
      .from(costBooks)
      .get()?.m ?? -1) + 1;
  try {
    const row = ctx.db
      .insert(costBooks)
      .values({
        name: input.name,
        slug,
        icon: input.icon ?? null,
        defaultSplitMode: input.defaultSplitMode ?? "ownership",
        taxRelevant: input.taxRelevant ?? false,
        sortOrder: input.sortOrder ?? next,
      })
      .returning({ id: costBooks.id })
      .get();
    return getCostBook(ctx, row.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("A cost book with this name or slug already exists");
    }
    throw err;
  }
}

/**
 * Changes a book. Archiving closes it to new entries (its entries and payments stay and still count in the balances) and
 * restoring reopens it; the last book that is not archived cannot be archived. Switching `taxRelevant` off keeps what its
 * entries say about their tax class, which then stays out of the tax breakdown.
 */
export function updateCostBook(
  ctx: ServiceContext,
  id: string,
  patch: UpdateCostBookRequest,
): CostBookRecord {
  const current = getCostBook(ctx, id);
  if (patch.name !== undefined && nameTaken(ctx, patch.name, id)) {
    throw conflict("A cost book with this name already exists");
  }
  if (patch.slug && patch.slug !== current.slug && slugTaken(ctx, patch.slug)) {
    throw conflict("A cost book with this slug already exists");
  }
  if (
    patch.archived === true &&
    current.archivedAt === null &&
    activeCount(ctx) <= 1
  ) {
    throw conflict(
      "This is the last cost book that is not archived; create another one first",
    );
  }
  const { archived, ...fields } = patch;
  try {
    ctx.db
      .update(costBooks)
      .set({
        ...fields,
        ...(archived === undefined
          ? {}
          : {
              archivedAt: archived
                ? (current.archivedAt ?? new Date(ctx.now))
                : null,
            }),
      })
      .where(eq(costBooks.id, id))
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("A cost book with this name or slug already exists");
    }
    throw err;
  }
  return getCostBook(ctx, id);
}

/**
 * Deletes an empty book. One with entries or payments is a 409 that says how many (`details.entryCount`,
 * `details.settlementCount`): archive it instead. The last book that is not archived stays.
 */
export function deleteCostBook(ctx: Db, id: string): void {
  const current = getCostBook(ctx, id);
  if (current.entryCount > 0 || current.settlementCount > 0) {
    throw conflict(
      "This cost book still has entries or payments; archive it instead",
      {
        entryCount: current.entryCount,
        settlementCount: current.settlementCount,
      },
    );
  }
  if (current.archivedAt === null && activeCount(ctx) <= 1) {
    throw conflict(
      "This is the last cost book that is not archived; create another one first",
    );
  }
  ctx.db.delete(costBooks).where(eq(costBooks.id, id)).run();
}
