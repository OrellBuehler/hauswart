import {
  and,
  desc,
  eq,
  lt,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type {
  CreateSettlementRequest,
  ListSettlementsQuery,
  UpdateSettlementRequest,
} from "$lib/api/schemas/settlements";
import { minor } from "$lib/money";
import { costBooks, settlements, users } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { getCostBookRow, requireCostBook } from "./books";
import { costConflict } from "./conflicts";
import { yearRange } from "./costs";

type Db = Pick<ServiceContext, "db">;

export type SettlementRow = typeof settlements.$inferSelect;

export interface SettlementRecord extends SettlementRow {
  bookName: string | null;
  fromName: string | null;
  toName: string | null;
}

const from = alias(users, "settlement_from");
const to = alias(users, "settlement_to");

const name = (user: { displayName: AnyColumn; username: AnyColumn }) =>
  sql<string | null>`coalesce(${user.displayName}, ${user.username})`;

const selectSettlements = (db: Db["db"]) =>
  db
    .select({
      settlement: settlements,
      bookName: costBooks.name,
      fromName: name(from),
      toName: name(to),
      rowid: sql<number>`${settlements}.rowid`,
    })
    .from(settlements)
    .leftJoin(costBooks, eq(costBooks.id, settlements.bookId))
    .innerJoin(from, eq(from.id, settlements.fromUserId))
    .innerJoin(to, eq(to.id, settlements.toUserId));

type Joined = ReturnType<ReturnType<typeof selectSettlements>["all"]>[number];

const recordOf = (j: Joined): SettlementRecord => ({
  ...j.settlement,
  bookName: j.bookName,
  fromName: j.fromName,
  toName: j.toName,
});

export function findSettlement(
  ctx: Db,
  id: string,
): SettlementRecord | undefined {
  const row = selectSettlements(ctx.db).where(eq(settlements.id, id)).get();
  return row ? recordOf(row) : undefined;
}

export function getSettlement(ctx: Db, id: string): SettlementRecord {
  const settlement = findSettlement(ctx, id);
  if (!settlement) throw notFound("Settlement");
  return settlement;
}

const cursorSchema = z.object({
  d: z.string(),
  t: z.number().int(),
  r: z.number().int(),
});

/**
 * Newest first by date, then by when it was entered; keyset pages on (date, createdAt, rowid). A `bookId` that names no
 * book is a 404 like everywhere else a book is read, never an empty list.
 */
export function listSettlements(
  ctx: Db,
  filter: Omit<ListSettlementsQuery, "cursor" | "limit">,
  page: { cursor?: string; limit: number },
  viewerId: string,
) {
  const where: SQL[] = [];
  if (filter.bookId) {
    getCostBookRow(ctx, filter.bookId);
    where.push(eq(settlements.bookId, filter.bookId));
  }
  if (filter.year !== undefined) {
    const range = yearRange(filter.year);
    where.push(
      sql`${settlements.date} >= ${range.from}`,
      sql`${settlements.date} <= ${range.to}`,
    );
  }
  if (filter.from) where.push(sql`${settlements.date} >= ${filter.from}`);
  if (filter.to) where.push(sql`${settlements.date} <= ${filter.to}`);
  if (filter.userId) {
    const who = filter.userId === "me" ? viewerId : filter.userId;
    where.push(
      or(eq(settlements.fromUserId, who), eq(settlements.toUserId, who)) as SQL,
    );
  }
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(settlements.date, at.d),
        and(
          eq(settlements.date, at.d),
          or(
            lt(settlements.createdAt, new Date(at.t)),
            and(
              eq(settlements.createdAt, new Date(at.t)),
              lt(sql`${settlements}.rowid`, at.r),
            ),
          ),
        ),
      ) as SQL,
    );
  }
  const rows = selectSettlements(ctx.db)
    .where(and(...where))
    .orderBy(
      desc(settlements.date),
      desc(settlements.createdAt),
      desc(sql`${settlements}.rowid`),
    )
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    d: r.settlement.date,
    t: r.settlement.createdAt.getTime(),
    r: r.rowid,
  }));
  return { items: paged.items.map(recordOf), nextCursor: paged.nextCursor };
}

function assertMember(ctx: Db, id: string, field: string) {
  const hit = ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .get();
  if (!hit) throw invalidField(field, "User does not exist");
}

function assertParties(ctx: Db, fromUserId: string, toUserId: string) {
  assertMember(ctx, fromUserId, "fromUserId");
  assertMember(ctx, toUserId, "toUserId");
  if (fromUserId === toUserId) {
    throw invalidField("toUserId", "A payment needs two different people");
  }
}

/**
 * Records a payment between two people. It is not a cost: it counts in no expense total, it only moves the balances
 * (`GET /costs/balances`). A payment may name a book, archived or not (closing a trip and paying later is the normal
 * order), or none to settle across all books.
 */
export function createSettlement(
  ctx: ServiceContext,
  input: CreateSettlementRequest,
  createdBy: string | null,
): SettlementRecord {
  assertParties(ctx, input.fromUserId, input.toUserId);
  if (input.bookId) requireCostBook(ctx, input.bookId);
  const id = ctx.db
    .insert(settlements)
    .values({
      bookId: input.bookId ?? null,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amountMinor: minor(input.amountMinor),
      currency: input.currency ?? getHousehold(ctx).currency,
      date: input.date ?? clockAt(ctx.now).today,
      note: input.note ?? null,
      createdBy,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: new Date(ctx.now),
    })
    .returning({ id: settlements.id })
    .get().id;
  return getSettlement(ctx, id);
}

/** The payment the person recorded with this key, if any. */
function findByKey(
  ctx: Db,
  createdBy: string,
  key: string,
): SettlementRecord | undefined {
  const row = selectSettlements(ctx.db)
    .where(
      and(
        eq(settlements.createdBy, createdBy),
        eq(settlements.idempotencyKey, key),
      ),
    )
    .get();
  return row ? recordOf(row) : undefined;
}

/** A retry names the same payment: same people, amount, currency and book (date and note do not count). */
function sameRequest(
  ctx: Db,
  existing: SettlementRecord,
  input: CreateSettlementRequest,
): boolean {
  return (
    existing.fromUserId === input.fromUserId &&
    existing.toUserId === input.toUserId &&
    existing.amountMinor === input.amountMinor &&
    existing.currency === (input.currency ?? getHousehold(ctx).currency) &&
    existing.bookId === (input.bookId ?? null)
  );
}

/**
 * `createSettlement` for a request that may be sent twice. With an `idempotencyKey` the person's earlier payment with
 * that key is returned (`replayed`) and nothing is recorded; the same key for a different payment is a 409. Once the
 * payment is deleted its key is free again. Without a key (or without a person) every call records a payment.
 */
export function recordSettlement(
  ctx: ServiceContext,
  input: CreateSettlementRequest,
  createdBy: string | null,
): { settlement: SettlementRecord; replayed: boolean } {
  const key = input.idempotencyKey;
  const replay = () => {
    if (!key || createdBy === null) return null;
    const existing = findByKey(ctx, createdBy, key);
    if (!existing) return null;
    if (!sameRequest(ctx, existing, input)) {
      throw costConflict(
        "idempotency_key_reused",
        "This idempotency key was used for another payment",
      );
    }
    return { settlement: existing, replayed: true };
  };
  const first = replay();
  if (first) return first;
  try {
    return {
      settlement: createSettlement(ctx, input, createdBy),
      replayed: false,
    };
  } catch (err) {
    if (key && isUniqueViolation(err)) {
      const raced = replay();
      if (raced) return raced;
    }
    throw err;
  }
}

export function updateSettlement(
  ctx: ServiceContext,
  id: string,
  patch: UpdateSettlementRequest,
): SettlementRecord {
  const current = getSettlement(ctx, id);
  assertParties(
    ctx,
    patch.fromUserId ?? current.fromUserId,
    patch.toUserId ?? current.toUserId,
  );
  if (patch.bookId) requireCostBook(ctx, patch.bookId);
  const { amountMinor, ...fields } = patch;
  ctx.db
    .update(settlements)
    .set({
      ...fields,
      ...(amountMinor === undefined ? {} : { amountMinor: minor(amountMinor) }),
    })
    .where(eq(settlements.id, id))
    .run();
  return getSettlement(ctx, id);
}

export function deleteSettlement(ctx: Db, id: string): void {
  const removed = ctx.db
    .delete(settlements)
    .where(eq(settlements.id, id))
    .returning({ id: settlements.id })
    .all();
  if (removed.length === 0) throw notFound("Settlement");
}
