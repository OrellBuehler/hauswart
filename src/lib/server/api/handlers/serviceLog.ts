import type { endpoints } from "$lib/api/registry";
import {
  createEntry,
  deleteEntry,
  getAssetEntry,
  listAssetEntries,
  listServiceLog,
  updateEntry,
} from "$lib/server/service-log/service-log";
import { refreshOdometerReaders } from "$lib/server/vehicles/odometer";
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

export const create: Handler<typeof endpoints.assetServiceLogCreate> = async ({
  ctx,
  params,
  body,
}) => {
  const entry = createEntry(ctx, params.id, body, ctx.user.id);
  // An odometer value is a reading: the tasks that count on the odometer follow at once.
  if (entry.odometer !== null) await refreshOdometerReaders(ctx, entry.assetId);
  return wireServiceLogEntry(entry);
};

export const get: Handler<typeof endpoints.assetServiceLogGet> = ({
  ctx,
  params,
}) => wireServiceLogEntry(getAssetEntry(ctx, params.id, params.entryId));

export const update: Handler<typeof endpoints.assetServiceLogUpdate> = async ({
  ctx,
  params,
  body,
}) => {
  const entry = updateEntry(ctx, params.id, params.entryId, body);
  if (body.odometer !== undefined || entry.odometer !== null) {
    await refreshOdometerReaders(ctx, entry.assetId);
  }
  return wireServiceLogEntry(entry);
};

export const remove: Handler<typeof endpoints.assetServiceLogDelete> = async ({
  ctx,
  params,
}) => {
  const had = getAssetEntry(ctx, params.id, params.entryId).odometer !== null;
  deleteEntry(ctx, params.id, params.entryId);
  if (had) await refreshOdometerReaders(ctx, params.id);
  return null;
};
