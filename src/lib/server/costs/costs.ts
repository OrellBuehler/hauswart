import {
  and,
  count,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  COST_CATEGORY_COUNTS_AS_EXPENSE,
  type CostCategory,
  type CostDeductible,
  type CostSource,
  type CostSplitMode,
} from "$lib/api/enums";
import type {
  CreateCostRequest,
  ListCostsQuery,
  UpdateCostRequest,
} from "$lib/api/schemas/costs";
import { minor } from "$lib/money";
import {
  assertTaskOpenForBooking,
  takeLease,
} from "$lib/server/ai-tasks/booking";
import type { CostTagRef } from "$lib/api/schemas/cost-tags";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { commentCountSql } from "$lib/server/comments/counts";
import {
  assets,
  costBooks,
  costEntries,
  costEntryShares,
  costLinkRemovals,
  defects,
  rooms,
  serviceLog,
  users,
  type DB,
} from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import {
  defaultCostBook,
  findCostBookRow,
  getCostBookRow,
  requireOpenCostBook,
  type CostBookRow,
} from "./books";
import {
  amountsFor,
  listPeople,
  sharesFor,
  validateCustomShares,
  validateParticipants,
  type Share,
} from "./split";
import {
  getCostTagRow,
  requireTagIds,
  tagsOfEntries,
  writeEntryTags,
} from "./tags";

type Db = Pick<ServiceContext, "db">;

export type CostRow = typeof costEntries.$inferSelect;

export interface CostShareRecord {
  userId: string;
  userName: string | null;
  shareBps: number;
  amountMinor: number;
}

export interface CostRecord extends CostRow {
  bookName: string;
  bookTaxRelevant: boolean;
  assetName: string | null;
  roomName: string | null;
  defectNumber: number | null;
  defectTitle: string | null;
  serviceLogTitle: string | null;
  paidByName: string | null;
  commentCount: number;
  /** The fuel log entry that booked this entry, which then owns its amount, currency and date. */
  fuelLogId: string | null;
  shares: CostShareRecord[];
  tags: CostTagRef[];
}

const payer = alias(users, "payer");

const selectCosts = (db: DB) =>
  db
    .select({
      cost: costEntries,
      bookName: costBooks.name,
      bookTaxRelevant: costBooks.taxRelevant,
      assetName: assets.name,
      roomName: rooms.name,
      defectNumber: defects.number,
      defectTitle: defects.title,
      serviceLogTitle: serviceLog.title,
      paidByName: sql<
        string | null
      >`coalesce(${payer.displayName}, ${payer.username})`,
      commentCount: commentCountSql("cost", costEntries.id),
      fuelLogId: sql<
        string | null
      >`(select fuel_logs.id from fuel_logs where fuel_logs.cost_entry_id = ${costEntries.id} limit 1)`,
      rowid: sql<number>`${costEntries}.rowid`,
    })
    .from(costEntries)
    .innerJoin(costBooks, eq(costBooks.id, costEntries.bookId))
    .leftJoin(assets, eq(assets.id, costEntries.assetId))
    .leftJoin(rooms, eq(rooms.id, costEntries.roomId))
    .leftJoin(defects, eq(defects.id, costEntries.defectId))
    .leftJoin(serviceLog, eq(serviceLog.id, costEntries.serviceLogId))
    .leftJoin(payer, eq(payer.id, costEntries.paidByUserId));

type Joined = ReturnType<ReturnType<typeof selectCosts>["all"]>[number];

/** The frozen shares of the given entries, with the part of the amount each person bears. */
function sharesOf(
  db: DB,
  rows: readonly CostRow[],
): Map<string, CostShareRecord[]> {
  const out = new Map<string, CostShareRecord[]>();
  if (rows.length === 0) return out;
  const stored = db
    .select({
      entryId: costEntryShares.entryId,
      userId: costEntryShares.userId,
      shareBps: costEntryShares.shareBps,
      name: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(costEntryShares)
    .innerJoin(users, eq(users.id, costEntryShares.userId))
    .where(
      inArray(
        costEntryShares.entryId,
        rows.map((r) => r.id),
      ),
    )
    .all();
  const names = new Map(stored.map((s) => [s.userId, s.name]));
  const byEntry = new Map<string, Share[]>();
  for (const s of stored) {
    byEntry.set(s.entryId, [
      ...(byEntry.get(s.entryId) ?? []),
      { userId: s.userId, shareBps: s.shareBps },
    ]);
  }
  for (const row of rows) {
    out.set(
      row.id,
      amountsFor(row.amountMinor, byEntry.get(row.id) ?? []).map((a) => ({
        ...a,
        userName: names.get(a.userId) ?? null,
      })),
    );
  }
  return out;
}

function toRecords(db: DB, joined: readonly Joined[]): CostRecord[] {
  const shares = sharesOf(
    db,
    joined.map((j) => j.cost),
  );
  const tags = tagsOfEntries(
    db,
    joined.map((j) => j.cost.id),
  );
  return joined.map((j) => ({
    ...j.cost,
    bookName: j.bookName,
    bookTaxRelevant: j.bookTaxRelevant,
    assetName: j.assetName,
    roomName: j.roomName,
    defectNumber: j.defectNumber,
    defectTitle: j.defectTitle,
    serviceLogTitle: j.serviceLogTitle,
    paidByName: j.paidByName,
    commentCount: Number(j.commentCount),
    fuelLogId: j.fuelLogId,
    shares: shares.get(j.cost.id) ?? [],
    tags: tags.get(j.cost.id) ?? [],
  }));
}

export function findCost(ctx: Db, id: string): CostRecord | undefined {
  const row = selectCosts(ctx.db).where(eq(costEntries.id, id)).get();
  return row ? toRecords(ctx.db, [row])[0] : undefined;
}

export function getCost(ctx: Db, id: string): CostRecord {
  const cost = findCost(ctx, id);
  if (!cost) throw notFound("Cost entry");
  return cost;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const yearRange = (year: number) => ({
  from: `${String(year).padStart(4, "0")}-01-01`,
  to: `${String(year).padStart(4, "0")}-12-31`,
});

/** Entries that carry the tag; written against the table by name so any query over `cost_entries` can use it. */
export const hasTag = (tagId: string): SQL =>
  sql`exists (select 1 from cost_entry_tags where cost_entry_tags.entry_id = cost_entries.id and cost_entry_tags.tag_id = ${tagId})`;

function whereOf(filter: ListCostsQuery, viewerId: string): SQL[] {
  const where: SQL[] = [];
  if (filter.year !== undefined) {
    const { from, to } = yearRange(filter.year);
    where.push(
      sql`${costEntries.date} >= ${from}`,
      sql`${costEntries.date} <= ${to}`,
    );
  }
  if (filter.from) where.push(sql`${costEntries.date} >= ${filter.from}`);
  if (filter.to) where.push(sql`${costEntries.date} <= ${filter.to}`);
  if (filter.bookId) where.push(eq(costEntries.bookId, filter.bookId));
  if (filter.category) where.push(eq(costEntries.category, filter.category));
  if (filter.assetId) where.push(eq(costEntries.assetId, filter.assetId));
  if (filter.roomId) where.push(eq(costEntries.roomId, filter.roomId));
  if (filter.defectId) where.push(eq(costEntries.defectId, filter.defectId));
  if (filter.paidBy) {
    where.push(
      eq(
        costEntries.paidByUserId,
        filter.paidBy === "me" ? viewerId : filter.paidBy,
      ),
    );
  }
  if (filter.tagId) where.push(hasTag(filter.tagId));
  if (filter.reviewNeeded !== undefined) {
    where.push(eq(costEntries.reviewNeeded, filter.reviewNeeded));
  }
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    where.push(
      or(
        sql`lower(${costEntries.title}) like ${pattern} escape '\\'`,
        sql`lower(${costEntries.payee}) like ${pattern} escape '\\'`,
        sql`lower(${costEntries.notes}) like ${pattern} escape '\\'`,
      ) as SQL,
    );
  }
  return where;
}

const cursorSchema = z.object({
  d: z.string(),
  t: z.number().int(),
  r: z.number().int(),
});

/**
 * Newest first by date, then by when it was entered; keyset pages on (date, createdAt, rowid). A `bookId` that names no
 * book is a 404, not an empty list.
 */
export function listCosts(
  ctx: Db,
  filter: Omit<ListCostsQuery, "cursor" | "limit">,
  page: { cursor?: string; limit: number },
  viewerId: string,
) {
  if (filter.bookId) getCostBookRow(ctx, filter.bookId);
  if (filter.tagId) getCostTagRow(ctx, filter.tagId);
  const where = whereOf(filter as ListCostsQuery, viewerId);
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(costEntries.date, at.d),
        and(
          eq(costEntries.date, at.d),
          or(
            lt(costEntries.createdAt, new Date(at.t)),
            and(
              eq(costEntries.createdAt, new Date(at.t)),
              lt(sql`${costEntries}.rowid`, at.r),
            ),
          ),
        ),
      ) as SQL,
    );
  }
  const rows = selectCosts(ctx.db)
    .where(and(...where))
    .orderBy(
      desc(costEntries.date),
      desc(costEntries.createdAt),
      desc(sql`${costEntries}.rowid`),
    )
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    d: r.cost.date,
    t: r.cost.createdAt.getTime(),
    r: r.rowid,
  }));
  return {
    items: toRecords(ctx.db, paged.items),
    nextCursor: paged.nextCursor,
  };
}

function assertRef(
  ctx: Db,
  table: typeof assets | typeof rooms | typeof defects | typeof serviceLog,
  id: string | null | undefined,
  field: string,
  label: string,
) {
  if (!id) return;
  const hit = ctx.db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id))
    .get();
  if (!hit) throw invalidField(field, `${label} does not exist`);
}

function assertUser(ctx: Db, id: string | null | undefined) {
  if (!id) return;
  const hit = ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .get();
  if (!hit) throw invalidField("paidByUserId", "User does not exist");
}

/** What a finance provider adds to an entry booked from one of its items. */
export interface ProviderOrigin {
  source: Exclude<CostSource, "manual" | "recurring">;
  connectionId: string;
  ref: string;
  url: string | null;
}

/**
 * The frozen shares for a split. `participantIds` narrows an `equal` split to those people (everybody without it);
 * `shares` belong to `custom` alone.
 */
function resolveSplit(
  ctx: Db,
  mode: CostSplitMode,
  custom: readonly Share[] | undefined,
  participantIds?: readonly string[],
): Share[] {
  if (mode === "custom") {
    if (!custom)
      throw invalidField("shares", "Shares are required for a custom split");
    if (participantIds) {
      throw invalidField(
        "participantIds",
        "Participants are only allowed for an equal split",
      );
    }
    return validateCustomShares(ctx, custom);
  }
  if (custom) {
    throw invalidField("shares", "Shares are only allowed for a custom split");
  }
  if (participantIds) {
    if (mode !== "equal") {
      throw invalidField(
        "participantIds",
        "Participants are only allowed for an equal split",
      );
    }
    return sharesFor("equal", validateParticipants(ctx, participantIds));
  }
  return sharesFor(mode, listPeople(ctx));
}

/**
 * The tax class means something in a tax relevant book only. Anywhere else a class other than `unknown` is a 400 on
 * `deductible`, except the one the entry already has (a book that stopped being tax relevant keeps what its entries
 * say, and sending that back is no change).
 */
function assertDeductible(
  book: Pick<CostBookRow, "taxRelevant">,
  deductible: CostDeductible,
  current: CostDeductible = "unknown",
) {
  if (!book.taxRelevant && deductible !== "unknown" && deductible !== current) {
    throw invalidField(
      "deductible",
      "The tax class only applies to cost books that are tax relevant",
    );
  }
}

function writeShares(db: DB, entryId: string, shares: readonly Share[]) {
  db.delete(costEntryShares).where(eq(costEntryShares.entryId, entryId)).run();
  if (shares.length > 0) {
    db.insert(costEntryShares)
      .values(shares.map((s) => ({ entryId, ...s })))
      .run();
  }
}

/**
 * Everything a new entry is checked against before it is written: the references exist, the book takes entries, the
 * split and the tags are valid for the tax class. Answers what the entry is split by.
 */
function prepareCost(ctx: Db, input: CreateCostRequest) {
  assertRef(ctx, assets, input.assetId, "assetId", "Asset");
  assertRef(ctx, rooms, input.roomId, "roomId", "Room");
  assertRef(ctx, defects, input.defectId, "defectId", "Defect");
  assertRef(
    ctx,
    serviceLog,
    input.serviceLogId,
    "serviceLogId",
    "Service log entry",
  );
  assertUser(ctx, input.paidByUserId);
  const book = input.bookId
    ? requireOpenCostBook(ctx, input.bookId)
    : defaultCostBook(ctx);
  const splitMode = input.splitMode ?? book.defaultSplitMode;
  const shares = resolveSplit(
    ctx,
    splitMode,
    input.shares,
    input.participantIds,
  );
  assertDeductible(book, input.deductible);
  const tagIds = requireTagIds(ctx, input.tagIds ?? []);
  return { book, splitMode, shares, tagIds };
}

/** Checks a template of entries (a recurring cost) as booking it would, and writes nothing. */
export function checkCostTemplate(ctx: Db, input: CreateCostRequest): void {
  prepareCost(ctx, input);
}

/**
 * Books a cost. The split is frozen with the entry. Defaults: today, the
 * household currency, and the asset or room of the linked service log entry
 * or defect.
 */
export function createCost(
  ctx: ServiceContext,
  input: CreateCostRequest,
  createdBy: string | null,
  origin?: ProviderOrigin,
  recurrence?: { id: string; date: string },
): CostRecord {
  const { book, splitMode, shares, tagIds } = prepareCost(ctx, input);
  if (input.receiptTaskId) assertTaskOpenForBooking(ctx, input.receiptTaskId);

  let assetId = input.assetId ?? null;
  let roomId = input.roomId ?? null;
  if (input.serviceLogId && assetId === null) {
    assetId =
      ctx.db
        .select({ assetId: serviceLog.assetId })
        .from(serviceLog)
        .where(eq(serviceLog.id, input.serviceLogId))
        .get()?.assetId ?? null;
  }
  if (input.defectId && (assetId === null || roomId === null)) {
    const defect = ctx.db
      .select({ assetId: defects.assetId, roomId: defects.roomId })
      .from(defects)
      .where(eq(defects.id, input.defectId))
      .get();
    assetId ??= defect?.assetId ?? null;
    roomId ??= defect?.roomId ?? null;
  }

  let id: string;
  try {
    id = ctx.db.transaction((tx) => {
      const row = tx
        .insert(costEntries)
        .values({
          bookId: book.id,
          date: input.date ?? clockAt(ctx.now).today,
          title: input.title,
          amountMinor: minor(input.amountMinor),
          currency: input.currency ?? getHousehold(ctx).currency,
          category: input.category,
          assetId,
          roomId,
          defectId: input.defectId ?? null,
          serviceLogId: input.serviceLogId ?? null,
          payee: input.payee ?? null,
          notes: input.notes ?? null,
          paidByUserId: input.paidByUserId ?? null,
          splitMode,
          countsAsExpense:
            input.countsAsExpense ??
            COST_CATEGORY_COUNTS_AS_EXPENSE[input.category],
          deductible: input.deductible,
          source: origin?.source ?? (recurrence ? "recurring" : "manual"),
          recurrenceId: recurrence?.id ?? null,
          recurrenceDate: recurrence?.date ?? null,
          providerConnectionId: origin?.connectionId ?? null,
          providerRef: origin?.ref ?? null,
          providerUrl: origin?.url ?? null,
          createdBy,
          idempotencyKey: input.idempotencyKey ?? null,
          // booked on the strength of a receipt somebody else read: a person confirms it once
          reviewNeeded: input.receiptTaskId !== undefined,
          aiTaskId: input.receiptTaskId ?? null,
          createdAt: new Date(ctx.now),
        })
        .returning({ id: costEntries.id })
        .get().id;
      writeShares(tx as unknown as DB, row, shares);
      writeEntryTags(tx as unknown as DB, row, tagIds);
      if (input.receiptTaskId) {
        takeLease(
          { db: tx as unknown as DB, now: ctx.now },
          input.receiptTaskId,
          createdBy,
        );
      }
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // The key's own index is for `recordCost` to answer; the provider's index means the item is booked already.
      if (
        createdBy &&
        input.idempotencyKey &&
        findCostByKey(ctx, createdBy, input.idempotencyKey)
      ) {
        throw err;
      }
      if (recurrence) throw conflict("This occurrence is already booked");
      throw conflict("This item of the finance provider is already booked");
    }
    throw err;
  }
  if (origin) {
    emitEvent("financeLinksPending", {
      ctx,
      connectionId: origin.connectionId,
    });
  }
  return getCost(ctx, id);
}

/** The entry the person booked with this key, if any. */
export function findCostByKey(
  ctx: Db,
  createdBy: string,
  key: string,
): CostRecord | undefined {
  const row = selectCosts(ctx.db)
    .where(
      and(
        eq(costEntries.createdBy, createdBy),
        eq(costEntries.idempotencyKey, key),
      ),
    )
    .get();
  return row ? toRecords(ctx.db, [row])[0] : undefined;
}

/**
 * A retry names the same entry: same amount, currency, category, title and receipt task, and the same book, date and
 * payer when the retry names them (a request that left them to the defaults accepts whatever the first one got). Notes,
 * payee, device and the other links do not count.
 */
function sameRequest(
  ctx: Db,
  existing: CostRecord,
  input: CreateCostRequest,
): boolean {
  return (
    existing.amountMinor === input.amountMinor &&
    existing.currency === (input.currency ?? getHousehold(ctx).currency) &&
    existing.category === input.category &&
    existing.title === input.title &&
    (input.bookId === undefined || existing.bookId === input.bookId) &&
    (input.date === undefined || existing.date === input.date) &&
    (input.paidByUserId === undefined ||
      existing.paidByUserId === input.paidByUserId) &&
    existing.aiTaskId === (input.receiptTaskId ?? null)
  );
}

/**
 * `createCost` for a request that may be sent twice. With an `idempotencyKey` the person's earlier entry with that key is
 * returned (`replayed`) and nothing is booked; the same key for a different entry is a 409. Once the entry is deleted its
 * key is free again. Without a key (or without a person) every call books an entry.
 */
export function recordCost(
  ctx: ServiceContext,
  input: CreateCostRequest,
  createdBy: string | null,
): { cost: CostRecord; replayed: boolean } {
  const key = input.idempotencyKey;
  const replay = () => {
    if (!key || createdBy === null) return null;
    const existing = findCostByKey(ctx, createdBy, key);
    if (!existing) return null;
    if (!sameRequest(ctx, existing, input)) {
      throw conflict("This idempotency key was used for another cost entry");
    }
    return { cost: existing, replayed: true };
  };
  const first = replay();
  if (first) return first;
  try {
    return { cost: createCost(ctx, input, createdBy), replayed: false };
  } catch (err) {
    if (key && isUniqueViolation(err)) {
      const raced = replay();
      if (raced) return raced;
    }
    throw err;
  }
}

/**
 * Changes an entry. An entry a fuel log entry booked keeps its amount, currency, date and device as
 * the fuel log entry has them: asking for other values is a 409 `conflict` with `details.fuelLogId`
 * (repeating the current ones is fine, and everything else stays editable). Only that fuel log
 * entry, saying so in `options.fuelLogId`, may move the amount, currency and date; it does so from
 * its own update, which never sends a device (that stays the vehicle).
 */
export function updateCost(
  ctx: ServiceContext,
  id: string,
  patch: UpdateCostRequest,
  options: { fuelLogId?: string } = {},
): CostRecord {
  const current = getCost(ctx, id);
  if (
    current.fuelLogId !== null &&
    current.fuelLogId !== options.fuelLogId &&
    ((patch.amountMinor !== undefined &&
      patch.amountMinor !== current.amountMinor) ||
      (patch.currency !== undefined && patch.currency !== current.currency) ||
      (patch.date !== undefined && patch.date !== current.date) ||
      (patch.assetId !== undefined && patch.assetId !== current.assetId))
  ) {
    throw conflict(
      "This cost entry was booked by a fuel log entry; change its amount, currency and date there, its device is the vehicle and stays",
      { fuelLogId: current.fuelLogId },
    );
  }
  if (patch.assetId !== undefined) {
    assertRef(ctx, assets, patch.assetId, "assetId", "Asset");
  }
  if (patch.roomId !== undefined) {
    assertRef(ctx, rooms, patch.roomId, "roomId", "Room");
  }
  if (patch.defectId !== undefined) {
    assertRef(ctx, defects, patch.defectId, "defectId", "Defect");
  }
  if (patch.serviceLogId !== undefined) {
    assertRef(
      ctx,
      serviceLog,
      patch.serviceLogId,
      "serviceLogId",
      "Service log entry",
    );
  }
  if (patch.paidByUserId !== undefined) assertUser(ctx, patch.paidByUserId);

  const moved = patch.bookId !== undefined && patch.bookId !== current.bookId;
  const book = moved
    ? requireOpenCostBook(ctx, patch.bookId as string)
    : (findCostBookRow(ctx, current.bookId) as CostBookRow);
  if (patch.deductible !== undefined) {
    assertDeductible(book, patch.deductible, current.deductible);
  }
  // What an entry says about its tax class means nothing in a book without one: moving it there starts over.
  const resetDeductible =
    moved &&
    !book.taxRelevant &&
    patch.deductible === undefined &&
    current.deductible !== "unknown";

  const {
    shares: customShares,
    participantIds,
    splitMode,
    amountMinor,
    tagIds: tagIdsPatch,
    ...fields
  } = patch;
  const tagIds =
    tagIdsPatch === undefined ? undefined : requireTagIds(ctx, tagIdsPatch);
  let nextShares: Share[] | undefined;
  if (customShares !== undefined) {
    if ((splitMode ?? current.splitMode) !== "custom") {
      throw invalidField(
        "shares",
        "Shares are only allowed for a custom split",
      );
    }
    nextShares = resolveSplit(ctx, "custom", customShares, participantIds);
  } else if (participantIds !== undefined) {
    if ((splitMode ?? current.splitMode) !== "equal") {
      throw invalidField(
        "participantIds",
        "Participants are only allowed for an equal split",
      );
    }
    nextShares = resolveSplit(ctx, "equal", undefined, participantIds);
  } else if (splitMode !== undefined) {
    if (splitMode === "custom") {
      if (current.splitMode !== "custom") {
        throw invalidField("shares", "Shares are required for a custom split");
      }
    } else {
      nextShares = resolveSplit(ctx, splitMode, undefined);
    }
  }

  const categoryChanged =
    patch.category !== undefined && patch.category !== current.category;
  const defaultExpense =
    categoryChanged &&
    patch.countsAsExpense === undefined &&
    current.countsAsExpense ===
      COST_CATEGORY_COUNTS_AS_EXPENSE[current.category]
      ? COST_CATEGORY_COUNTS_AS_EXPENSE[patch.category as CostCategory]
      : undefined;

  const linkAffected =
    current.providerConnectionId !== null &&
    ((patch.title !== undefined && patch.title !== current.title) ||
      (patch.assetId !== undefined && patch.assetId !== current.assetId));

  const set = {
    ...fields,
    ...(resetDeductible ? { deductible: "unknown" as const } : {}),
    ...(amountMinor === undefined ? {} : { amountMinor: minor(amountMinor) }),
    // Naming the mode even when it stays keeps the update from being empty when only the shares change.
    ...(splitMode === undefined
      ? nextShares
        ? { splitMode: current.splitMode }
        : {}
      : { splitMode }),
    ...(defaultExpense === undefined
      ? {}
      : { countsAsExpense: defaultExpense }),
    ...(linkAffected ? { linkSyncedAt: null } : {}),
  };
  ctx.db.transaction((tx) => {
    // A change of the tags alone still counts as a change of the entry.
    tx.update(costEntries)
      .set(
        Object.keys(set).length === 0 ? { updatedAt: new Date(ctx.now) } : set,
      )
      .where(eq(costEntries.id, id))
      .run();
    if (nextShares) writeShares(tx as unknown as DB, id, nextShares);
    if (tagIds) writeEntryTags(tx as unknown as DB, id, tagIds);
  });
  if (linkAffected && current.providerConnectionId) {
    emitEvent("financeLinksPending", {
      ctx,
      connectionId: current.providerConnectionId,
    });
  }
  return getCost(ctx, id);
}

/**
 * Removes the entry with its shares, comments and attachments; a back-link in the provider is queued
 * for removal. An entry a fuel log entry booked goes with that entry: 409 `conflict` with
 * `details.fuelLogId` while it exists (the fuel log entry lets go of its cost entry before it
 * deletes it).
 */
export function deleteCost(ctx: ServiceContext, id: string): void {
  const current = getCost(ctx, id);
  if (current.fuelLogId !== null) {
    throw conflict(
      "This cost entry was booked by a fuel log entry; delete the fuel log entry instead",
      { fuelLogId: current.fuelLogId },
    );
  }
  ctx.db.transaction((tx) => {
    if (current.providerConnectionId && current.providerLinkId) {
      tx.insert(costLinkRemovals)
        .values({
          connectionId: current.providerConnectionId,
          linkId: current.providerLinkId,
        })
        .run();
    }
    tx.delete(costEntries).where(eq(costEntries.id, id)).run();
  });
  removeOwnedAttachments(ctx, "cost", id);
  if (current.providerConnectionId && current.providerLinkId) {
    emitEvent("financeLinksPending", {
      ctx,
      connectionId: current.providerConnectionId,
    });
  }
}

/** How many entries, in any book and year, a person still has to review. */
export function countReviewNeeded(ctx: Db): number {
  return (
    ctx.db
      .select({ n: count() })
      .from(costEntries)
      .where(eq(costEntries.reviewNeeded, true))
      .get()?.n ?? 0
  );
}

/**
 * Asks for a look at these entries (those that exist): the flag is set, and who reviewed them before and when is
 * forgotten. Entries are booked from a receipt somebody else read, so a person confirms them once.
 */
export function flagForReview(ctx: Db, ids: readonly string[]): void {
  if (ids.length === 0) return;
  ctx.db
    .update(costEntries)
    .set({ reviewNeeded: true, reviewedAt: null, reviewedByUserId: null })
    .where(inArray(costEntries.id, [...ids]))
    .run();
}

/**
 * Marks an entry as reviewed by `userId` now. Reviewing an entry nobody has to review changes nothing (and keeps who
 * reviewed it first), so a double click or a retry is harmless.
 */
export function reviewCost(
  ctx: ServiceContext,
  id: string,
  userId: string,
): CostRecord {
  const current = getCost(ctx, id);
  if (!current.reviewNeeded) return current;
  ctx.db
    .update(costEntries)
    .set({
      reviewNeeded: false,
      reviewedAt: new Date(ctx.now),
      reviewedByUserId: userId,
    })
    .where(and(eq(costEntries.id, id), eq(costEntries.reviewNeeded, true)))
    .run();
  return getCost(ctx, id);
}
