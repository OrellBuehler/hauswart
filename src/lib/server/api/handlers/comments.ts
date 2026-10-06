import type { endpoints } from "$lib/api/registry";
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from "$lib/server/comments/comments";
import type { Handler } from "../bind";
import { wireComment } from "../wire";

export const list: Handler<typeof endpoints.commentsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, entityType, entityId } = query;
  const page = listComments(
    ctx,
    { id: ctx.user.id, role: ctx.user.role },
    { entityType, entityId },
    { cursor, limit },
  );
  return { items: page.items.map(wireComment), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.commentsCreate> = async ({
  ctx,
  body,
}) =>
  wireComment(
    await createComment(ctx, { id: ctx.user.id, role: ctx.user.role }, body),
  );

export const update: Handler<typeof endpoints.commentsUpdate> = ({
  ctx,
  params,
  body,
}) =>
  wireComment(
    updateComment(
      ctx,
      { id: ctx.user.id, role: ctx.user.role },
      params.id,
      body.bodyMd,
    ),
  );

export const remove: Handler<typeof endpoints.commentsDelete> = ({
  ctx,
  params,
}) => {
  deleteComment(ctx, { id: ctx.user.id, role: ctx.user.role }, params.id);
  return null;
};
