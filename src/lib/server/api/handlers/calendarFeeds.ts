import type { endpoints } from "$lib/api/registry";
import {
  createFeed,
  listFeeds,
  revokeFeed,
  rotateFeed,
  updateFeed,
} from "$lib/server/calendar/feeds";
import type { Handler } from "../bind";
import { wireCalendarFeed } from "../wire-share";

export const list: Handler<typeof endpoints.calendarFeedsList> = ({
  ctx,
  event,
}) => ({
  items: listFeeds(ctx, ctx.user.id).map((f) =>
    wireCalendarFeed(f, event.url.origin),
  ),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.calendarFeedsCreate> = ({
  ctx,
  body,
  event,
}) => wireCalendarFeed(createFeed(ctx, ctx.user.id, body), event.url.origin);

export const update: Handler<typeof endpoints.calendarFeedsUpdate> = ({
  ctx,
  params,
  body,
  event,
}) =>
  wireCalendarFeed(
    updateFeed(ctx, ctx.user.id, params.id, body),
    event.url.origin,
  );

export const remove: Handler<typeof endpoints.calendarFeedsDelete> = ({
  ctx,
  params,
}) => {
  revokeFeed(ctx, ctx.user.id, params.id);
  return null;
};

export const rotate: Handler<typeof endpoints.calendarFeedsRotate> = ({
  ctx,
  params,
  event,
}) =>
  wireCalendarFeed(rotateFeed(ctx, ctx.user.id, params.id), event.url.origin);
