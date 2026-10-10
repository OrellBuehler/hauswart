import { eq } from "drizzle-orm";
import type {
  OdometerSummary,
  PutVehicleRequest,
} from "$lib/api/schemas/vehicles";
import { vehicleDetails } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { assertVehicleForRead, assertVehicleForWrite } from "./kind";
import { syncOdometerSignal } from "./signal";
import { odometerSummary } from "./summary";

type Ctx = Pick<ServiceContext, "db" | "now">;

export type VehicleRow = typeof vehicleDetails.$inferSelect;

export interface VehicleRecord extends Omit<
  VehicleRow,
  "createdAt" | "updatedAt"
> {
  odometer: OdometerSummary | null;
  /** Null while the details were never saved. */
  updatedAt: Date | null;
}

function toRecord(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  row: VehicleRow | undefined,
): VehicleRecord {
  const unit = row?.odometerUnit ?? "km";
  return {
    assetId,
    plate: row?.plate ?? null,
    vin: row?.vin ?? null,
    registrationNumber: row?.registrationNumber ?? null,
    firstRegistration: row?.firstRegistration ?? null,
    fuelType: row?.fuelType ?? null,
    tireSizeSummer: row?.tireSizeSummer ?? null,
    tireSizeWinter: row?.tireSizeWinter ?? null,
    location: row?.location ?? null,
    odometerUnit: unit,
    notes: row?.notes ?? null,
    odometer: odometerSummary(ctx.db, assetId, unit),
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The details of a vehicle. A vehicle whose details were never saved answers with the defaults;
 * an asset that is no vehicle has none (404).
 */
export function getVehicle(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
): VehicleRecord {
  assertVehicleForRead(ctx.db, assetId);
  return toRecord(
    ctx,
    assetId,
    ctx.db
      .select()
      .from(vehicleDetails)
      .where(eq(vehicleDetails.assetId, assetId))
      .get(),
  );
}

/**
 * Replaces the details of a vehicle (what the request leaves out is cleared). Only an asset of
 * kind `vehicle` has them: another kind is a 400, a missing asset a 404. A new odometer unit
 * relabels the readings and the signal, it does not convert them.
 */
export function putVehicle(
  ctx: Ctx,
  assetId: string,
  body: PutVehicleRequest,
): VehicleRecord {
  assertVehicleForWrite(ctx.db, assetId, "these details");
  const values = {
    plate: body.plate ?? null,
    vin: body.vin ?? null,
    registrationNumber: body.registrationNumber ?? null,
    firstRegistration: body.firstRegistration ?? null,
    fuelType: body.fuelType ?? null,
    tireSizeSummer: body.tireSizeSummer ?? null,
    tireSizeWinter: body.tireSizeWinter ?? null,
    location: body.location ?? null,
    odometerUnit: body.odometerUnit ?? ("km" as const),
    notes: body.notes ?? null,
  };
  ctx.db.transaction((tx) => {
    const before = tx
      .select({ unit: vehicleDetails.odometerUnit })
      .from(vehicleDetails)
      .where(eq(vehicleDetails.assetId, assetId))
      .get();
    tx.insert(vehicleDetails)
      .values({ assetId, ...values, createdAt: new Date(ctx.now) })
      .onConflictDoUpdate({
        target: vehicleDetails.assetId,
        set: { ...values, updatedAt: new Date(ctx.now) },
      })
      .run();
    if ((before?.unit ?? "km") !== values.odometerUnit) {
      syncOdometerSignal(
        { ...ctx, db: tx as unknown as typeof ctx.db },
        assetId,
      );
    }
  });
  return getVehicle(ctx, assetId);
}
