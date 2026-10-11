import type { endpoints } from "$lib/api/registry";
import { refreshOdometerReaders } from "$lib/server/vehicles/odometer";
import {
  createTireSet,
  deleteTireSet,
  getTireSet,
  listTireSets,
  measureTread,
  mountTireSet,
  updateTireSet,
} from "$lib/server/vehicles/tires";
import type { Handler } from "../bind";
import { wireTireSet, wireTireSetDetail } from "../wire";

export const list: Handler<typeof endpoints.tireSetsList> = ({
  ctx,
  params,
  query,
}) => {
  const { cursor, limit, includeRetired } = query;
  const page = listTireSets(
    ctx,
    params.id,
    { includeRetired },
    { cursor, limit },
  );
  return {
    items: page.items.map((s) => wireTireSet(s, ctx.today)),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.tireSetsCreate> = ({
  ctx,
  params,
  body,
}) => wireTireSetDetail(createTireSet(ctx, params.id, body), ctx.today);

export const get: Handler<typeof endpoints.tireSetsGet> = ({ ctx, params }) =>
  wireTireSetDetail(getTireSet(ctx, params.id), ctx.today);

export const update: Handler<typeof endpoints.tireSetsUpdate> = ({
  ctx,
  params,
  body,
}) => wireTireSetDetail(updateTireSet(ctx, params.id, body), ctx.today);

export const remove: Handler<typeof endpoints.tireSetsDelete> = async ({
  ctx,
  params,
}) => {
  const { assetId } = getTireSet(ctx, params.id);
  deleteTireSet(ctx, params.id);
  // The readings its events wrote are gone: the tasks that count on the odometer follow.
  await refreshOdometerReaders(ctx, assetId);
  return null;
};

export const mount: Handler<typeof endpoints.tireSetsMount> = async ({
  ctx,
  params,
  body,
}) => {
  const set = mountTireSet(ctx, params.id, params.setId, body, ctx.user.id);
  if (body.odometer !== undefined) await refreshOdometerReaders(ctx, params.id);
  return wireTireSetDetail(set, ctx.today);
};

export const tread: Handler<typeof endpoints.tireSetsTread> = async ({
  ctx,
  params,
  body,
}) => {
  const set = measureTread(ctx, params.id, body, ctx.user.id);
  if (body.odometer !== undefined) {
    await refreshOdometerReaders(ctx, set.assetId);
  }
  return wireTireSetDetail(set, ctx.today);
};
