import type { endpoints } from "$lib/api/registry";
import {
  createAsset,
  deleteAsset,
  getAsset,
  getAssetByQr,
  listAssets,
  updateAsset,
} from "$lib/server/assets/assets";
import type { Handler } from "../bind";
import { wireAsset } from "../wire";

export const list: Handler<typeof endpoints.assetsList> = ({ ctx, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listAssets(ctx, filter, { cursor, limit });
  return { items: page.items.map(wireAsset), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.assetsCreate> = ({ ctx, body }) =>
  wireAsset(createAsset(ctx, body));

export const get: Handler<typeof endpoints.assetsGet> = ({ ctx, params }) =>
  wireAsset(getAsset(ctx, params.id));

export const byQr: Handler<typeof endpoints.assetsByQr> = ({ ctx, params }) =>
  wireAsset(getAssetByQr(ctx, params.qrSlug));

export const update: Handler<typeof endpoints.assetsUpdate> = ({
  ctx,
  params,
  body,
}) => wireAsset(updateAsset(ctx, params.id, body));

export const remove: Handler<typeof endpoints.assetsDelete> = ({
  ctx,
  params,
}) => {
  deleteAsset(ctx, params.id);
  return null;
};
