import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { CommentEntityType, UserLocale } from "$lib/api/enums";
import { comments, users } from "$lib/server/db";
import type { DeliverableNotification } from "$lib/server/notifications/channels";
import { deliverToChannels } from "$lib/server/notifications/deliveries";
import { createNotification } from "$lib/server/notifications/notifications";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  forbidden,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { commentableOf } from "./registry";

type Now = Pick<ServiceContext, "db" | "now">;

/** Who is asking: comments are shared, but only their author edits them. */
export interface Viewer {
  id: string;
  role: "admin" | "member";
}

export interface CommentRecord {
  id: string;
  entityType: CommentEntityType;
  entityId: string;
  author: { id: string; displayName: string } | null;
  bodyMd: string;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

type Row = typeof comments.$inferSelect;
type Joined = { comment: Row; authorName: string | null; rowid: number };

const selectComments = (db: Now["db"]) =>
  db
    .select({
      comment: comments,
      authorName: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
      rowid: sql<number>`${comments}.rowid`,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.userId));

function toRecord(
  { comment, authorName }: Joined,
  viewer: Viewer,
): CommentRecord {
  const deleted = comment.deletedAt !== null;
  const isAuthor = comment.userId !== null && comment.userId === viewer.id;
  return {
    id: comment.id,
    entityType: comment.entityType,
    entityId: comment.entityId,
    author:
      comment.userId === null
        ? null
        : { id: comment.userId, displayName: authorName ?? "" },
    bodyMd: deleted ? "" : comment.bodyMd,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    deleted,
    canEdit: isAuthor && !deleted,
    canDelete: (isAuthor || viewer.role === "admin") && !deleted,
  };
}

function assertEntity(
  db: Now["db"],
  type: CommentEntityType,
  id: string,
): NonNullable<ReturnType<typeof commentableOf>> {
  const commentable = commentableOf(type);
  if (!commentable?.exists(db, id)) throw notFound("Entity");
  return commentable;
}

const cursorSchema = z.object({ t: z.number().int(), r: z.number().int() });

/** Oldest first, deleted comments included (empty); keyset pages on (createdAt, id). */
export function listComments(
  ctx: Now,
  viewer: Viewer,
  target: { entityType: CommentEntityType; entityId: string },
  page: { cursor?: string; limit: number },
) {
  assertEntity(ctx.db, target.entityType, target.entityId);
  const where: SQL[] = [
    eq(comments.entityType, target.entityType),
    eq(comments.entityId, target.entityId),
  ];
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        gt(comments.createdAt, new Date(at.t)),
        and(
          eq(comments.createdAt, new Date(at.t)),
          gt(sql`${comments}.rowid`, at.r),
        ),
      ) as SQL,
    );
  }
  const rows = selectComments(ctx.db)
    .where(and(...where))
    .orderBy(asc(comments.createdAt), asc(sql`${comments}.rowid`))
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    t: r.comment.createdAt.getTime(),
    r: r.rowid,
  }));
  return {
    items: paged.items.map((r) => toRecord(r, viewer)),
    nextCursor: paged.nextCursor,
  };
}

/** Every comment of one entity, oldest first (for timelines and exports). */
export function allCommentsOf(
  ctx: Pick<Now, "db">,
  viewer: Viewer,
  entityType: CommentEntityType,
  entityId: string,
): CommentRecord[] {
  return selectComments(ctx.db)
    .where(
      and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
    )
    .orderBy(asc(comments.createdAt), asc(sql`${comments}.rowid`))
    .all()
    .map((r) => toRecord(r, viewer));
}

function getRow(ctx: Pick<Now, "db">, id: string): Joined {
  const row = selectComments(ctx.db).where(eq(comments.id, id)).get();
  if (!row) throw notFound("Comment");
  return row;
}

export async function createComment(
  ctx: Now,
  viewer: Viewer,
  input: { entityType: CommentEntityType; entityId: string; bodyMd: string },
): Promise<CommentRecord> {
  const commentable = assertEntity(ctx.db, input.entityType, input.entityId);
  const row = ctx.db
    .insert(comments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      userId: viewer.id,
      bodyMd: input.bodyMd,
      createdAt: new Date(ctx.now),
    })
    .returning({ id: comments.id })
    .get();
  const record = toRecord(getRow(ctx, row.id), viewer);
  await notifyAbout(ctx, record, commentable, viewer);
  return record;
}

async function notifyAbout(
  ctx: Now,
  comment: CommentRecord,
  commentable: NonNullable<ReturnType<typeof commentableOf>>,
  viewer: Viewer,
): Promise<void> {
  const everyone = ctx.db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .all();
  const involved = commentable.audience?.(ctx.db, comment.entityId) ?? null;
  const recipients = everyone.filter(
    (u) => u.id !== viewer.id && (involved === null || involved.includes(u.id)),
  );
  if (recipients.length === 0) return;
  const params = {
    author: comment.author?.displayName ?? "",
    title: commentable.title(ctx.db, comment.entityId) ?? "",
  };
  const url = commentable.url(ctx.db, comment.entityId);
  for (const person of recipients) {
    const created = createNotification(ctx, {
      userId: person.id,
      kind: "comment",
      taskId: comment.entityType === "task" ? comment.entityId : null,
      dedupeKey: `comment:${comment.id}:${person.id}`,
      titleKey: "notification_comment",
      params,
      url,
    });
    if (!created) continue;
    const deliverable: DeliverableNotification = {
      id: created.id,
      userId: created.userId,
      kind: created.kind,
      taskId: created.taskId,
      titleKey: created.titleKey,
      params: created.paramsJson,
      url: created.url,
      createdAt: created.createdAt,
    };
    await deliverToChannels(ctx, deliverable, [
      { id: person.id, locale: person.locale as UserLocale },
    ]);
  }
}

export function updateComment(
  ctx: Now,
  viewer: Viewer,
  id: string,
  bodyMd: string,
): CommentRecord {
  const current = getRow(ctx, id);
  if (current.comment.userId !== viewer.id) {
    throw forbidden("Only the author may edit a comment");
  }
  if (current.comment.deletedAt) {
    throw conflict("A deleted comment cannot be edited");
  }
  ctx.db
    .update(comments)
    .set({ bodyMd, editedAt: new Date(ctx.now) })
    .where(eq(comments.id, id))
    .run();
  return toRecord(getRow(ctx, id), viewer);
}

/** Soft delete: the row stays so the thread keeps its order, the text is erased. Twice is fine. */
export function deleteComment(ctx: Now, viewer: Viewer, id: string): void {
  const current = getRow(ctx, id);
  if (current.comment.userId !== viewer.id && viewer.role !== "admin") {
    throw forbidden("Only the author or an administrator may delete a comment");
  }
  if (current.comment.deletedAt) return;
  ctx.db
    .update(comments)
    .set({ deletedAt: new Date(ctx.now), bodyMd: "" })
    .where(eq(comments.id, id))
    .run();
}

/** All comments of an entity, deleted ones included. */
export function countCommentsOf(
  ctx: Pick<Now, "db">,
  entityType: CommentEntityType,
  entityId: string,
): number {
  return ctx.db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
    )
    .all().length;
}
