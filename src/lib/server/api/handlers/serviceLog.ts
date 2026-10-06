import type { endpoints } from "$lib/api/registry";
import {
  createEntry,
  deleteEntry,
  getAssetEntry,
  listAssetEntries,
  listServiceLog,
  updateEntry,
} from "$lib/server/service-log/service-log";
import type { Handler } from "../bind";
import { wireServiceLogEntry } from "../wire";

export const listAll: Handler<typeof endpoints.serviceLogList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listServiceLog(ctx, filter, { cursor, limit });
  return {
    items: page.items.map(wireServiceLogEntry),
    nextCursor: page.nextCursor,
  };
};

export const listForAsset: Handler<typeof endpoints.assetServiceLogList> = ({
  ctx,
  params,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listAssetEntries(ctx, params.id, filter, { cursor, limit });
  return {
    items: page.items.map(wireServiceLogEntry),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.assetServiceLogCreate> = ({
  ctx,
  params,
  body,
}) => wireServiceLogEntry(createEntry(ctx, params.id, body, ctx.user.id));

export const get: Handler<typeof endpoints.assetServiceLogGet> = ({
  ctx,
  params,
}) => wireServiceLogEntry(getAssetEntry(ctx, params.id, params.entryId));

export const update: Handler<typeof endpoints.assetServiceLogUpdate> = ({
  ctx,
  params,
  body,
}) => wireServiceLogEntry(updateEntry(ctx, params.id, params.entryId, body));

export const remove: Handler<typeof endpoints.assetServiceLogDelete> = ({
  ctx,
  params,
}) => {
  deleteEntry(ctx, params.id, params.entryId);
  return null;
};
