import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import type { PartMovementReason } from "$lib/api/enums";
import type {
  CreatePartRequest,
  UpdatePartRequest,
} from "$lib/api/schemas/parts";
import { PART_MOVEMENTS_IN_DETAIL } from "$lib/api/schemas/parts";
import { minor } from "$lib/money";
import {
  assetParts,
  assets,
  partMovements,
  parts,
  taskParts,
  taskPreparations,
  tasks,
  users,
} from "$lib/server/db";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, paginateArray, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type PartRow = typeof parts.$inferSelect;
export interface PartRecord extends PartRow {
  lowStock: boolean;
}

export function toPartRecord(row: PartRow): PartRecord {
  return { ...row, lowStock: row.stockCount < row.minStock };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface PartFilter {
  q?: string;
  assetId?: string;
  taskId?: string;
  lowStock?: boolean;
  includeArchived?: boolean;
}

export function listParts(
  ctx: Db,
  filter: PartFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (!filter.includeArchived) where.push(isNull(parts.archivedAt));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    const match = (column: Parameters<typeof like>[0]) =>
      sql`lower(${column}) like ${pattern} escape '\\'`;
    where.push(
      or(
        match(parts.name),
        match(parts.partNumber),
        match(parts.supplier),
      ) as SQL,
    );
  }
  if (filter.assetId) {
    where.push(
      inArray(
        parts.id,
        ctx.db
          .select({ id: assetParts.partId })
          .from(assetParts)
          .where(eq(assetParts.assetId, filter.assetId)),
      ),
    );
  }
  if (filter.taskId) {
    where.push(
      inArray(
        parts.id,
        ctx.db
          .select({ id: taskParts.partId })
          .from(taskParts)
          .where(eq(taskParts.taskId, filter.taskId)),
      ),
    );
  }
  if (filter.lowStock) where.push(lt(parts.stockCount, parts.minStock));
  const rows = ctx.db
    .select()
    .from(parts)
    .where(and(...where))
    .orderBy(asc(sql`lower(${parts.name})`), asc(parts.id))
    .all()
    .map(toPartRecord);
  return paginateArray(rows, page.cursor, page.limit);
}

export function findPart(ctx: Db, id: string): PartRecord | undefined {
  const row = ctx.db.select().from(parts).where(eq(parts.id, id)).get();
  return row && toPartRecord(row);
}

export function getPart(ctx: Db, id: string): PartRecord {
  const part = findPart(ctx, id);
  if (!part) throw notFound("Part");
  return part;
}

export interface MovementRecord {
  id: string;
  partId: string;
  delta: number;
  reason: PartMovementReason;
  userId: string | null;
  userName: string | null;
  completionId: string | null;
  note: string | null;
  at: Date;
}

const selectMovements = (db: Db["db"]) =>
  db
    .select({
      id: partMovements.id,
      partId: partMovements.partId,
      delta: partMovements.delta,
      reason: partMovements.reason,
      userId: partMovements.userId,
      userName: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
      completionId: partMovements.completionId,
      note: partMovements.note,
      at: partMovements.at,
      rowid: sql<number>`${partMovements}.rowid`,
    })
    .from(partMovements)
    .leftJoin(users, eq(users.id, partMovements.userId));

const movementCursor = z.object({ t: z.number().int(), r: z.number().int() });

/** Newest first; keyset pages on (at, id). */
export function listMovements(
  ctx: Db,
  partId: string,
  page: { cursor?: string; limit: number },
) {
  getPart(ctx, partId);
  const where: SQL[] = [eq(partMovements.partId, partId)];
  if (page.cursor) {
    const at = decodeCursor(page.cursor, movementCursor);
    where.push(
      or(
        lt(partMovements.at, new Date(at.t)),
        and(
          eq(partMovements.at, new Date(at.t)),
          lt(sql`${partMovements}.rowid`, at.r),
        ),
      ) as SQL,
    );
  }
  const rows = selectMovements(ctx.db)
    .where(and(...where))
    .orderBy(desc(partMovements.at), desc(sql`${partMovements}.rowid`))
    .limit(page.limit + 1)
    .all();
  return pageOf(rows, page.limit, (r) => ({ t: r.at.getTime(), r: r.rowid }));
}

export interface PartDetailRecord extends PartRecord {
  assets: { id: string; name: string }[];
  tasks: { id: string; title: string; qty: number }[];
  recentMovements: MovementRecord[];
}

export function getPartDetail(ctx: Db, id: string): PartDetailRecord {
  const part = getPart(ctx, id);
  return {
    ...part,
    assets: ctx.db
      .select({ id: assets.id, name: assets.name })
      .from(assetParts)
      .innerJoin(assets, eq(assets.id, assetParts.assetId))
      .where(eq(assetParts.partId, id))
      .orderBy(asc(assets.name), asc(assets.id))
      .all(),
    tasks: ctx.db
      .select({ id: tasks.id, title: tasks.title, qty: taskParts.qty })
      .from(taskParts)
      .innerJoin(tasks, eq(tasks.id, taskParts.taskId))
      .where(and(eq(taskParts.partId, id), isNull(tasks.archivedAt)))
      .orderBy(asc(tasks.title), asc(tasks.id))
      .all(),
    recentMovements: selectMovements(ctx.db)
      .where(eq(partMovements.partId, id))
      .orderBy(desc(partMovements.at), desc(sql`${partMovements}.rowid`))
      .limit(PART_MOVEMENTS_IN_DETAIL)
      .all(),
  };
}

export interface MovementInput {
  delta: number;
  reason: PartMovementReason;
  userId: string | null;
  completionId?: string | null;
  note?: string | null;
}

/**
 * Changes the stock and writes the movement; a `bought` movement also ends a
 * pending order. With `clamp` the stock stops at zero and the movement records
 * what was actually taken (completions use this: the shelf count may simply be
 * out of date); without it, going below zero is an error. Returns the applied
 * delta, 0 when nothing changed (then no movement is written).
 */
export function applyMovement(
  ctx: Now,
  partId: string,
  input: MovementInput,
  options: { clamp?: boolean } = {},
): number {
  const part = ctx.db.select().from(parts).where(eq(parts.id, partId)).get();
  if (!part) throw notFound("Part");
  let delta = input.delta;
  if (part.stockCount + delta < 0) {
    if (!options.clamp) {
      throw invalidField("delta", "Stock cannot go below zero");
    }
    delta = -part.stockCount;
  }
  if (delta === 0) return 0;
  ctx.db
    .update(parts)
    .set({
      stockCount: part.stockCount + delta,
      ...(input.reason === "bought" ? { orderedAt: null, orderedQty: 0 } : {}),
    })
    .where(eq(parts.id, partId))
    .run();
  ctx.db
    .insert(partMovements)
    .values({
      partId,
      delta,
      reason: input.reason,
      userId: input.userId,
      completionId: input.completionId ?? null,
      note: input.note ?? null,
      at: new Date(ctx.now),
      createdAt: new Date(ctx.now),
    })
    .run();
  return delta;
}

export function bookStock(
  ctx: Now,
  partId: string,
  input: MovementInput,
): PartRecord {
  applyMovement(ctx, partId, input);
  return getPart(ctx, partId);
}

export function createPart(
  ctx: Now,
  input: CreatePartRequest,
  userId: string | null,
): PartRecord {
  const currency = input.currency ?? getHousehold(ctx).currency;
  const id = ctx.db.transaction((tx) => {
    const row = tx
      .insert(parts)
      .values({
        name: input.name,
        partNumber: input.partNumber ?? null,
        supplier: input.supplier ?? null,
        shopUrl: input.shopUrl ?? null,
        unitPriceMinor:
          input.unitPriceMinor === undefined || input.unitPriceMinor === null
            ? null
            : minor(input.unitPriceMinor),
        currency,
        stockCount: input.stockCount,
        minStock: input.minStock,
        reorderQty: input.reorderQty,
        leadTimeDays: input.leadTimeDays,
        notes: input.notes ?? null,
      })
      .returning({ id: parts.id })
      .get();
    if (input.stockCount > 0) {
      tx.insert(partMovements)
        .values({
          partId: row.id,
          delta: input.stockCount,
          reason: "correction",
          userId,
          note: null,
          at: new Date(ctx.now),
          createdAt: new Date(ctx.now),
        })
        .run();
    }
    return row.id;
  });
  return getPart(ctx, id);
}

export function updatePart(
  ctx: Now,
  id: string,
  patch: UpdatePartRequest,
): PartRecord {
  const current = getPart(ctx, id);
  const { archived, unitPriceMinor, ...fields } = patch;
  ctx.db
    .update(parts)
    .set({
      ...fields,
      ...(unitPriceMinor === undefined
        ? {}
        : {
            unitPriceMinor:
              unitPriceMinor === null ? null : minor(unitPriceMinor),
          }),
      ...(archived === undefined
        ? {}
        : {
            archivedAt: archived
              ? (current.archivedAt ?? new Date(ctx.now))
              : null,
          }),
    })
    .where(eq(parts.id, id))
    .run();
  return getPart(ctx, id);
}

/**
 * Removes the part with its links and movements. Preparations that named it
 * keep their text and lose the link (the column has no foreign key).
 */
export function deletePart(ctx: Now, id: string): void {
  getPart(ctx, id);
  ctx.db.transaction((tx) => {
    tx.update(taskPreparations)
      .set({ partId: null })
      .where(eq(taskPreparations.partId, id))
      .run();
    tx.delete(parts).where(eq(parts.id, id)).run();
  });
  removeOwnedAttachments(ctx, "part", id);
}

/** Records an order (default: the reorder quantity); qty 0 clears it. */
export function markOrdered(
  ctx: Now,
  id: string,
  qty: number | undefined,
): PartRecord {
  const part = getPart(ctx, id);
  const amount = qty ?? part.reorderQty;
  ctx.db
    .update(parts)
    .set(
      amount === 0
        ? { orderedAt: null, orderedQty: 0 }
        : { orderedAt: new Date(ctx.now), orderedQty: amount },
    )
    .where(eq(parts.id, id))
    .run();
  return getPart(ctx, id);
}
