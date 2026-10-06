import { and, asc, eq } from "drizzle-orm";
import { assetParts, assets, parts, taskParts, tasks } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { getPart, toPartRecord, type PartRecord } from "./parts";

type Db = Pick<ServiceContext, "db">;

function assertAsset(ctx: Db, assetId: string) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
}

function assertTask(ctx: Db, taskId: string) {
  const hit = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (!hit) throw notFound("Task");
}

export interface AssetPartRecord {
  assetId: string;
  partId: string;
  part: PartRecord;
}

export function listAssetParts(
  ctx: Db,
  assetId: string,
  page: { cursor?: string; limit: number },
) {
  assertAsset(ctx, assetId);
  const rows = ctx.db
    .select({ part: parts })
    .from(assetParts)
    .innerJoin(parts, eq(parts.id, assetParts.partId))
    .where(eq(assetParts.assetId, assetId))
    .orderBy(asc(parts.name), asc(parts.id))
    .all()
    .map(({ part }): AssetPartRecord => ({
      assetId,
      partId: part.id,
      part: toPartRecord(part),
    }));
  return paginateArray(rows, page.cursor, page.limit);
}

export function linkAssetPart(
  ctx: Db,
  assetId: string,
  partId: string,
): AssetPartRecord {
  assertAsset(ctx, assetId);
  const part = getPart(ctx, partId);
  try {
    ctx.db.insert(assetParts).values({ assetId, partId }).run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("This part is already linked to the asset");
    }
    throw err;
  }
  return { assetId, partId, part };
}

export function unlinkAssetPart(ctx: Db, assetId: string, partId: string) {
  const removed = ctx.db
    .delete(assetParts)
    .where(and(eq(assetParts.assetId, assetId), eq(assetParts.partId, partId)))
    .returning({ id: assetParts.id })
    .all();
  if (removed.length === 0) throw notFound("Link");
}

export interface TaskPartRecord {
  taskId: string;
  partId: string;
  qty: number;
  part: PartRecord;
}

export function listTaskParts(
  ctx: Db,
  taskId: string,
  page: { cursor?: string; limit: number },
) {
  assertTask(ctx, taskId);
  const rows = ctx.db
    .select({ part: parts, qty: taskParts.qty })
    .from(taskParts)
    .innerJoin(parts, eq(parts.id, taskParts.partId))
    .where(eq(taskParts.taskId, taskId))
    .orderBy(asc(parts.name), asc(parts.id))
    .all()
    .map(({ part, qty }): TaskPartRecord => ({
      taskId,
      partId: part.id,
      qty,
      part: toPartRecord(part),
    }));
  return paginateArray(rows, page.cursor, page.limit);
}

export function linkTaskPart(
  ctx: Db,
  taskId: string,
  partId: string,
  qty: number,
): TaskPartRecord {
  assertTask(ctx, taskId);
  const part = getPart(ctx, partId);
  try {
    ctx.db.insert(taskParts).values({ taskId, partId, qty }).run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("This part is already linked to the task");
    }
    throw err;
  }
  return { taskId, partId, qty, part };
}

export function updateTaskPart(
  ctx: Db,
  taskId: string,
  partId: string,
  qty: number,
): TaskPartRecord {
  const updated = ctx.db
    .update(taskParts)
    .set({ qty })
    .where(and(eq(taskParts.taskId, taskId), eq(taskParts.partId, partId)))
    .returning({ id: taskParts.id })
    .all();
  if (updated.length === 0) throw notFound("Link");
  return { taskId, partId, qty, part: getPart(ctx, partId) };
}

export function unlinkTaskPart(ctx: Db, taskId: string, partId: string) {
  const removed = ctx.db
    .delete(taskParts)
    .where(and(eq(taskParts.taskId, taskId), eq(taskParts.partId, partId)))
    .returning({ id: taskParts.id })
    .all();
  if (removed.length === 0) throw notFound("Link");
}
