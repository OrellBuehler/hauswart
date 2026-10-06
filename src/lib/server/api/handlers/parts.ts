import type { endpoints } from "$lib/api/registry";
import {
  linkAssetPart,
  linkTaskPart,
  listAssetParts,
  listTaskParts,
  unlinkAssetPart,
  unlinkTaskPart,
  updateTaskPart,
} from "$lib/server/parts/links";
import { listOrderNow } from "$lib/server/parts/order-now";
import {
  bookStock,
  createPart,
  deletePart,
  getPartDetail,
  listMovements,
  listParts,
  markOrdered,
  updatePart,
} from "$lib/server/parts/parts";
import type { Handler } from "../bind";
import {
  wireAssetPart,
  wireMovement,
  wireOrderNow,
  wirePart,
  wirePartDetail,
  wireTaskPart,
} from "../wire";

export const list: Handler<typeof endpoints.partsList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listParts(ctx, filter, { cursor, limit });
  return { items: page.items.map(wirePart), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.partsCreate> = ({ ctx, body }) =>
  wirePart(createPart(ctx, body, ctx.user.id));

export const orderNow: Handler<typeof endpoints.partsOrderNow> = ({ ctx }) => ({
  items: listOrderNow(ctx).map(wireOrderNow),
});

export const get: Handler<typeof endpoints.partsGet> = ({ ctx, params }) =>
  wirePartDetail(getPartDetail(ctx, params.id));

export const update: Handler<typeof endpoints.partsUpdate> = ({
  ctx,
  params,
  body,
}) => wirePart(updatePart(ctx, params.id, body));

export const remove: Handler<typeof endpoints.partsDelete> = ({
  ctx,
  params,
}) => {
  deletePart(ctx, params.id);
  return null;
};

export const stock: Handler<typeof endpoints.partsStock> = ({
  ctx,
  params,
  body,
}) =>
  wirePart(
    bookStock(ctx, params.id, {
      delta: body.delta,
      reason: body.reason,
      note: body.note,
      userId: ctx.user.id,
    }),
  );

export const movements: Handler<typeof endpoints.partsMovements> = ({
  ctx,
  params,
  query,
}) => {
  const page = listMovements(ctx, params.id, query);
  return { items: page.items.map(wireMovement), nextCursor: page.nextCursor };
};

export const ordered: Handler<typeof endpoints.partsOrdered> = ({
  ctx,
  params,
  body,
}) => wirePart(markOrdered(ctx, params.id, body.qty));

export const listForAsset: Handler<typeof endpoints.assetPartsList> = ({
  ctx,
  params,
  query,
}) => {
  const page = listAssetParts(ctx, params.id, query);
  return { items: page.items.map(wireAssetPart), nextCursor: page.nextCursor };
};

export const linkToAsset: Handler<typeof endpoints.assetPartsLink> = ({
  ctx,
  params,
  body,
}) => wireAssetPart(linkAssetPart(ctx, params.id, body.partId));

export const unlinkFromAsset: Handler<typeof endpoints.assetPartsUnlink> = ({
  ctx,
  params,
}) => {
  unlinkAssetPart(ctx, params.id, params.partId);
  return null;
};

export const listForTask: Handler<typeof endpoints.taskPartsList> = ({
  ctx,
  params,
  query,
}) => {
  const page = listTaskParts(ctx, params.id, query);
  return { items: page.items.map(wireTaskPart), nextCursor: page.nextCursor };
};

export const linkToTask: Handler<typeof endpoints.taskPartsLink> = ({
  ctx,
  params,
  body,
}) => wireTaskPart(linkTaskPart(ctx, params.id, body.partId, body.qty));

export const updateOnTask: Handler<typeof endpoints.taskPartsUpdate> = ({
  ctx,
  params,
  body,
}) => wireTaskPart(updateTaskPart(ctx, params.id, params.partId, body.qty));

export const unlinkFromTask: Handler<typeof endpoints.taskPartsUnlink> = ({
  ctx,
  params,
}) => {
  unlinkTaskPart(ctx, params.id, params.partId);
  return null;
};
