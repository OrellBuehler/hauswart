import type { endpoints } from "$lib/api/registry";
import {
  createFuelLog,
  deleteFuelLog,
  getFuelLog,
  listFuelLogs,
  updateFuelLog,
} from "$lib/server/vehicles/fuel-logs";
import { refreshOdometerReaders } from "$lib/server/vehicles/odometer";
import type { Handler } from "../bind";
import { wireFuelLog } from "../wire";

export const list: Handler<typeof endpoints.fuelLogsList> = ({
  ctx,
  params,
  query,
}) => {
  const { cursor, limit, year } = query;
  const page = listFuelLogs(ctx, params.id, { year }, { cursor, limit });
  return { items: page.items.map(wireFuelLog), nextCursor: page.nextCursor };
};

// The odometer of a fill is a reading: the tasks that count on the odometer follow at once.
export const create: Handler<typeof endpoints.fuelLogsCreate> = async ({
  ctx,
  params,
  body,
}) => {
  const log = createFuelLog(ctx, params.id, body, ctx.user.id);
  await refreshOdometerReaders(ctx, params.id);
  return wireFuelLog(log);
};

export const get: Handler<typeof endpoints.fuelLogsGet> = ({ ctx, params }) =>
  wireFuelLog(getFuelLog(ctx, params.id));

export const update: Handler<typeof endpoints.fuelLogsUpdate> = async ({
  ctx,
  params,
  body,
}) => {
  const log = updateFuelLog(ctx, params.id, body, ctx.user.id);
  await refreshOdometerReaders(ctx, log.assetId);
  return wireFuelLog(log);
};

export const remove: Handler<typeof endpoints.fuelLogsDelete> = async ({
  ctx,
  params,
}) => {
  const { assetId } = getFuelLog(ctx, params.id);
  deleteFuelLog(ctx, params.id);
  await refreshOdometerReaders(ctx, assetId);
  return null;
};
