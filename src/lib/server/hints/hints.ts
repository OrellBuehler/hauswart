import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { HintKind } from "$lib/api/enums";
import {
  signalReactionSchema,
  type CreateHintRequest,
  type SignalReaction,
  type UpdateHintRequest,
} from "$lib/api/schemas/hints";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { assetHints, assets, tasks, users, type DB } from "$lib/server/db";
import { commentCountSql } from "$lib/server/comments/counts";
import { parseStored } from "$lib/server/json";
import { paginateArray } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

type HintRow = typeof assetHints.$inferSelect;
export interface HintRecord extends Omit<HintRow, "reaction"> {
  assetName: string;
  taskTitle: string | null;
  reaction: SignalReaction | null;
  commentCount: number;
}

const selectHints = (db: DB) =>
  db
    .select({
      hint: assetHints,
      assetName: assets.name,
      taskTitle: tasks.title,
      commentCount: commentCountSql("asset_hint", assetHints.id),
    })
    .from(assetHints)
    .innerJoin(assets, eq(assets.id, assetHints.assetId))
    .leftJoin(tasks, eq(tasks.id, assetHints.taskId));

type Joined = {
  hint: HintRow;
  assetName: string;
  taskTitle: string | null;
  commentCount: number;
};
const toRecord = ({
  hint,
  assetName,
  taskTitle,
  commentCount,
}: Joined): HintRecord => ({
  ...hint,
  reaction:
    hint.reaction === null
      ? null
      : parseStored(signalReactionSchema, hint.reaction, "hint reaction"),
  assetName,
  taskTitle,
  commentCount: Number(commentCount),
});

const ordering = [
  desc(assetHints.pinned),
  asc(assetHints.sortOrder),
  asc(assetHints.createdAt),
  asc(assetHints.id),
];

function assertAsset(ctx: Db, assetId: string) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
}

function assertTask(ctx: Db, taskId: string | null | undefined) {
  if (!taskId) return;
  const hit = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (!hit) throw invalidField("taskId", "Task does not exist");
}

function assertReaction(ctx: Db, reaction: SignalReaction | null | undefined) {
  if (!reaction || !Array.isArray(reaction.notify)) return;
  const ids = [...new Set(reaction.notify)];
  const found = new Set(
    ctx.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, ids))
      .all()
      .map((u) => u.id),
  );
  if (ids.some((id) => !found.has(id))) {
    throw invalidField("reaction", "A user to notify does not exist");
  }
}

export interface HintFilter {
  assetId?: string;
  reactive?: boolean;
  kind?: HintKind;
}

export function listHints(
  ctx: Db,
  filter: HintFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [isNull(assets.archivedAt)];
  if (filter.assetId) where.push(eq(assetHints.assetId, filter.assetId));
  if (filter.kind) where.push(eq(assetHints.kind, filter.kind));
  if (filter.reactive) where.push(isNotNull(assetHints.reaction));
  const rows = selectHints(ctx.db)
    .where(and(...where))
    .orderBy(asc(sql`lower(${assets.name})`), asc(assets.id), ...ordering)
    .all()
    .map(toRecord);
  return paginateArray(rows, page.cursor, page.limit);
}

export function listAssetHints(
  ctx: Db,
  assetId: string,
  page: { cursor?: string; limit: number },
) {
  assertAsset(ctx, assetId);
  const rows = selectHints(ctx.db)
    .where(eq(assetHints.assetId, assetId))
    .orderBy(...ordering)
    .all()
    .map(toRecord);
  return paginateArray(rows, page.cursor, page.limit);
}

export function getHint(ctx: Db, id: string): HintRecord {
  const row = selectHints(ctx.db).where(eq(assetHints.id, id)).get();
  if (!row) throw notFound("Hint");
  return toRecord(row);
}

export function createHint(
  ctx: Db,
  assetId: string,
  input: CreateHintRequest,
): HintRecord {
  assertAsset(ctx, assetId);
  assertTask(ctx, input.taskId);
  assertReaction(ctx, input.reaction);
  const sortOrder =
    input.sortOrder ??
    (ctx.db
      .select({ max: sql<number | null>`max(${assetHints.sortOrder})` })
      .from(assetHints)
      .where(eq(assetHints.assetId, assetId))
      .get()?.max ?? -1) + 1;
  const row = ctx.db
    .insert(assetHints)
    .values({
      assetId,
      title: input.title,
      bodyMd: input.bodyMd,
      kind: input.kind,
      pinned: input.pinned,
      sortOrder,
      guestVisible: input.guestVisible,
      taskId: input.taskId ?? null,
      reaction: input.reaction ?? null,
    })
    .returning({ id: assetHints.id })
    .get();
  return getHint(ctx, row.id);
}

export function updateHint(
  ctx: Db,
  id: string,
  patch: UpdateHintRequest,
): HintRecord {
  getHint(ctx, id);
  if (patch.taskId !== undefined) assertTask(ctx, patch.taskId);
  assertReaction(ctx, patch.reaction);
  ctx.db.update(assetHints).set(patch).where(eq(assetHints.id, id)).run();
  return getHint(ctx, id);
}

export function deleteHint(ctx: Now, id: string): void {
  const removed = ctx.db
    .delete(assetHints)
    .where(eq(assetHints.id, id))
    .returning({ id: assetHints.id })
    .all();
  if (removed.length === 0) throw notFound("Hint");
  removeOwnedAttachments(ctx, "asset_hint", id);
}
