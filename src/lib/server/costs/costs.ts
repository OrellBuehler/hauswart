import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  COST_CATEGORY_COUNTS_AS_EXPENSE,
  type CostCategory,
  type CostSource,
  type CostSplitMode,
} from "$lib/api/enums";
import type {
  CreateCostRequest,
  ListCostsQuery,
  UpdateCostRequest,
} from "$lib/api/schemas/costs";
import { minor } from "$lib/money";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { commentCountSql } from "$lib/server/comments/counts";
import {
  assets,
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
  amountsFor,
  listPeople,
  sharesFor,
  validateCustomShares,
  type Share,
} from "./split";

type Db = Pick<ServiceContext, "db">;

export type CostRow = typeof costEntries.$inferSelect;

export interface CostShareRecord {
  userId: string;
  userName: string | null;
  shareBps: number;
  amountMinor: number;
}

export interface CostRecord extends CostRow {
  assetName: string | null;
  roomName: string | null;
  defectNumber: number | null;
  defectTitle: string | null;
  serviceLogTitle: string | null;
  paidByName: string | null;
  commentCount: number;
  shares: CostShareRecord[];
}

const payer = alias(users, "payer");

const selectCosts = (db: DB) =>
  db
    .select({
      cost: costEntries,
      assetName: assets.name,
      roomName: rooms.name,
      defectNumber: defects.number,
      defectTitle: defects.title,
      serviceLogTitle: serviceLog.title,
      paidByName: sql<
        string | null
      >`coalesce(${payer.displayName}, ${payer.username})`,
      commentCount: commentCountSql("cost", costEntries.id),
      rowid: sql<number>`${costEntries}.rowid`,
    })
    .from(costEntries)
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
  return joined.map((j) => ({
    ...j.cost,
    assetName: j.assetName,
    roomName: j.roomName,
    defectNumber: j.defectNumber,
    defectTitle: j.defectTitle,
    serviceLogTitle: j.serviceLogTitle,
    paidByName: j.paidByName,
    commentCount: Number(j.commentCount),
    shares: shares.get(j.cost.id) ?? [],
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

/** Newest first by date, then by when it was entered; keyset pages on (date, createdAt, rowid). */
export function listCosts(
  ctx: Db,
  filter: Omit<ListCostsQuery, "cursor" | "limit">,
  page: { cursor?: string; limit: number },
  viewerId: string,
) {
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
  source: Exclude<CostSource, "manual">;
  connectionId: string;
  ref: string;
  url: string | null;
}

function resolveSplit(
  ctx: Db,
  mode: CostSplitMode,
  custom: readonly Share[] | undefined,
): Share[] {
  if (mode === "custom") {
    if (!custom)
      throw invalidField("shares", "Shares are required for a custom split");
    return validateCustomShares(ctx, custom);
  }
  if (custom) {
    throw invalidField("shares", "Shares are only allowed for a custom split");
  }
  return sharesFor(mode, listPeople(ctx));
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
 * Books a cost. The split is frozen with the entry. Defaults: today, the
 * household currency, and the asset or room of the linked service log entry
 * or defect.
 */
export function createCost(
  ctx: ServiceContext,
  input: CreateCostRequest,
  createdBy: string | null,
  origin?: ProviderOrigin,
): CostRecord {
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
  const shares = resolveSplit(ctx, input.splitMode, input.shares);

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
          splitMode: input.splitMode,
          countsAsExpense:
            input.countsAsExpense ??
            COST_CATEGORY_COUNTS_AS_EXPENSE[input.category],
          deductible: input.deductible,
          source: origin?.source ?? "manual",
          providerConnectionId: origin?.connectionId ?? null,
          providerRef: origin?.ref ?? null,
          providerUrl: origin?.url ?? null,
          createdBy,
          createdAt: new Date(ctx.now),
        })
        .returning({ id: costEntries.id })
        .get().id;
      writeShares(tx as unknown as DB, row, shares);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
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

export function updateCost(
  ctx: ServiceContext,
  id: string,
  patch: UpdateCostRequest,
): CostRecord {
  const current = getCost(ctx, id);
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

  const { shares: customShares, splitMode, amountMinor, ...fields } = patch;
  let nextShares: Share[] | undefined;
  if (customShares !== undefined) {
    if ((splitMode ?? current.splitMode) !== "custom") {
      throw invalidField(
        "shares",
        "Shares are only allowed for a custom split",
      );
    }
    nextShares = resolveSplit(ctx, "custom", customShares);
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

  ctx.db.transaction((tx) => {
    tx.update(costEntries)
      .set({
        ...fields,
        ...(amountMinor === undefined
          ? {}
          : { amountMinor: minor(amountMinor) }),
        ...(splitMode === undefined ? {} : { splitMode }),
        ...(defaultExpense === undefined
          ? {}
          : { countsAsExpense: defaultExpense }),
        ...(linkAffected ? { linkSyncedAt: null } : {}),
      })
      .where(eq(costEntries.id, id))
      .run();
    if (nextShares) writeShares(tx as unknown as DB, id, nextShares);
  });
  if (linkAffected && current.providerConnectionId) {
    emitEvent("financeLinksPending", {
      ctx,
      connectionId: current.providerConnectionId,
    });
  }
  return getCost(ctx, id);
}

/** Removes the entry with its shares, comments and attachments; a back-link in the provider is queued for removal. */
export function deleteCost(ctx: ServiceContext, id: string): void {
  const current = getCost(ctx, id);
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
