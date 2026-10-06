import type { endpoints } from "$lib/api/registry";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "$lib/server/notifications/notifications";
import type { Handler } from "../bind";
import { wireNotification } from "../wire";

export const list: Handler<typeof endpoints.notificationsList> = ({
  ctx,
  query,
}) => {
  const page = listNotifications(
    ctx,
    ctx.user.id,
    { unread: query.unread },
    { cursor: query.cursor, limit: query.limit },
  );
  return {
    items: page.items.map(wireNotification),
    nextCursor: page.nextCursor,
  };
};

export const read: Handler<typeof endpoints.notificationsRead> = ({
  ctx,
  params,
}) => wireNotification(markRead(ctx, ctx.user.id, params.id));

export const readAll: Handler<typeof endpoints.notificationsReadAll> = ({
  ctx,
}) => ({ updated: markAllRead(ctx, ctx.user.id) });

export const count: Handler<typeof endpoints.notificationsUnreadCount> = ({
  ctx,
}) => ({ count: unreadCount(ctx, ctx.user.id) });
