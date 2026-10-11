import type { endpoints } from "$lib/api/registry";
import {
  deleteOdometerReading,
  listReadings,
  recordOdometer,
} from "$lib/server/vehicles/odometer";
import { vehicleStats } from "$lib/server/vehicles/stats";
import { getVehicle, putVehicle } from "$lib/server/vehicles/vehicles";
import type { Handler } from "../bind";
import { wireOdometerReading, wireTireSet, wireVehicle } from "../wire";

export const get: Handler<typeof endpoints.vehiclesGet> = ({ ctx, params }) =>
  wireVehicle(getVehicle(ctx, params.id));

export const put: Handler<typeof endpoints.vehiclesPut> = ({
  ctx,
  params,
  body,
}) => wireVehicle(putVehicle(ctx, params.id, body));

export const listOdometer: Handler<typeof endpoints.odometerList> = ({
  ctx,
  params,
  query,
}) => {
  const page = listReadings(ctx, params.id, query);
  return {
    items: page.items.map(wireOdometerReading),
    nextCursor: page.nextCursor,
  };
};

export const recordOdometerReading: Handler<
  typeof endpoints.odometerCreate
> = async ({ ctx, params, body }) =>
  wireOdometerReading(
    await recordOdometer(ctx, {
      assetId: params.id,
      date: body.date ?? ctx.today,
      value: body.value,
      source: "manual",
      note: body.note,
      createdBy: ctx.user.id,
      force: body.force,
    }),
  );

export const removeOdometerReading: Handler<
  typeof endpoints.odometerDelete
> = async ({ ctx, params }) => {
  await deleteOdometerReading(ctx, params.id);
  return null;
};

export const stats: Handler<typeof endpoints.vehicleStats> = async ({
  ctx,
  params,
  query,
}) => {
  const { today, tireSet, ...rest } = await vehicleStats(
    ctx,
    params.id,
    query.year,
  );
  return { ...rest, tireSet: tireSet ? wireTireSet(tireSet, today) : null };
};
