import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { NotificationKind, NotificationTitleKey } from "$lib/api/enums";
import { notifications } from "$lib/server/db";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import { notFound, type ServiceContext } from "$lib/server/service";

export type NotificationRow = typeof notifications.$inferSelect;

type Db = Pick<ServiceContext, "db">;

/** Rows the user may see: their own plus the household's. */
const visibleTo = (userId: string): SQL =>
  or(eq(notifications.userId, userId), isNull(notifications.userId)) as SQL;

const unreadFirst = sql`(${notifications.readAt} is null)`;

const cursorSchema = z.object({
  u: z.number().int().min(0).max(1),
  t: z.number().int(),
  id: z.string(),
});

/**
 * Unread first, then newest first. Keyset paging on (unread, createdAt, id):
 * marking items read between two requests cannot make a page repeat or skip.
 */
export function listNotifications(
  ctx: Db,
  userId: string,
  filter: { unread?: boolean },
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [visibleTo(userId)];
  if (filter.unread) where.push(isNull(notifications.readAt));
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        sql`${unreadFirst} < ${at.u}`,
        and(
          sql`${unreadFirst} = ${at.u}`,
          sql`${notifications.createdAt} < ${at.t}`,
        ),
        and(
          sql`${unreadFirst} = ${at.u}`,
          sql`${notifications.createdAt} = ${at.t}`,
          sql`${notifications.id} < ${at.id}`,
        ),
      ) as SQL,
    );
  }
  const rows = ctx.db
    .select({ row: notifications, unread: sql<number>`${unreadFirst}` })
    .from(notifications)
    .where(and(...where))
    .orderBy(
      desc(unreadFirst),
      desc(notifications.createdAt),
      desc(notifications.id),
    )
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    u: Number(r.unread),
    t: r.row.createdAt.getTime(),
    id: r.row.id,
  }));
  return { items: paged.items.map((r) => r.row), nextCursor: paged.nextCursor };
}

export function unreadCount(ctx: Db, userId: string): number {
  return (
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(visibleTo(userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

/** Marks one notification read. Someone else's notification is a 404; reading twice keeps the first time. */
export function markRead(
  ctx: Pick<ServiceContext, "db" | "now">,
  userId: string,
  id: string,
): NotificationRow {
  const row = ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), visibleTo(userId)))
    .get();
  if (!row) throw notFound("Notification");
  if (row.readAt) return row;
  return ctx.db
    .update(notifications)
    .set({ readAt: new Date(ctx.now) })
    .where(eq(notifications.id, id))
    .returning()
    .get();
}

export function markAllRead(
  ctx: Pick<ServiceContext, "db" | "now">,
  userId: string,
): number {
  return ctx.db
    .update(notifications)
    .set({ readAt: new Date(ctx.now) })
    .where(and(visibleTo(userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
    .all().length;
}

export interface NewNotification {
  userId: string | null;
  kind: NotificationKind;
  taskId: string | null;
  dedupeKey: string;
  titleKey: NotificationTitleKey;
  params: Record<string, string | number>;
  url: string | null;
}

/** Stores a notification unless one with the same dedupe key exists; null when it was a duplicate. */
export function createNotification(
  ctx: Pick<ServiceContext, "db" | "now">,
  input: NewNotification,
): NotificationRow | null {
  return (
    ctx.db
      .insert(notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        taskId: input.taskId,
        dedupeKey: input.dedupeKey,
        titleKey: input.titleKey,
        paramsJson: input.params,
        url: input.url,
        createdAt: new Date(ctx.now),
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning()
      .get() ?? null
  );
}
