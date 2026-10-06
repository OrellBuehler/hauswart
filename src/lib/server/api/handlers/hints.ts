import type { endpoints } from "$lib/api/registry";
import {
  createHint,
  deleteHint,
  getHint,
  listAssetHints,
  listHints,
  updateHint,
} from "$lib/server/hints/hints";
import type { Handler } from "../bind";
import { wireHint } from "../wire";

export const listForAsset: Handler<typeof endpoints.assetHintsList> = ({
  ctx,
  params,
  query,
}) => {
  const page = listAssetHints(ctx, params.id, query);
  return { items: page.items.map(wireHint), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.assetHintsCreate> = ({
  ctx,
  params,
  body,
}) => wireHint(createHint(ctx, params.id, body));

export const list: Handler<typeof endpoints.hintsList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listHints(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireHint), nextCursor: page.nextCursor };
};

export const get: Handler<typeof endpoints.hintsGet> = ({ ctx, params }) =>
  wireHint(getHint(ctx, params.id));

export const update: Handler<typeof endpoints.hintsUpdate> = ({
  ctx,
  params,
  body,
}) => wireHint(updateHint(ctx, params.id, body));

export const remove: Handler<typeof endpoints.hintsDelete> = ({
  ctx,
  params,
}) => {
  deleteHint(ctx, params.id);
  return null;
};
