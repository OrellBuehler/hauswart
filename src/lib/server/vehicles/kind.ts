import { count, eq } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import {
  assets,
  odometerReadings,
  tireSets,
  vehicleDetails,
  type DB,
} from "$lib/server/db";
import { notFound } from "$lib/server/service";

type Db = Pick<DB, "select">;

/**
 * What a vehicle has stored that only makes sense on a vehicle, as words for a message: saved
 * details (a row that says something; one saved with nothing in it, the odometer in km, does not
 * count), odometer readings and tire sets. Fuel log entries are not listed: each one is also an
 * odometer reading that cannot be deleted on its own, so the readings stand for them.
 */
export function storedVehicleData(db: Db, assetId: string): string[] {
  const held: string[] = [];
  const details = db
    .select()
    .from(vehicleDetails)
    .where(eq(vehicleDetails.assetId, assetId))
    .get();
  if (
    details &&
    (details.odometerUnit !== "km" ||
      [
        details.plate,
        details.vin,
        details.registrationNumber,
        details.firstRegistration,
        details.fuelType,
        details.tireSizeSummer,
        details.tireSizeWinter,
        details.location,
        details.notes,
      ].some((value) => value !== null))
  ) {
    held.push("saved details");
  }
  const readings = db
    .select({ n: count() })
    .from(odometerReadings)
    .where(eq(odometerReadings.assetId, assetId))
    .get();
  if (readings && readings.n > 0) held.push("odometer readings");
  const sets = db
    .select({ n: count() })
    .from(tireSets)
    .where(eq(tireSets.assetId, assetId))
    .get();
  if (sets && sets.n > 0) held.push("tire sets");
  return held;
}

function kindOf(db: Db, assetId: string) {
  const asset = db
    .select({ kind: assets.kind })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  return asset.kind;
}

/**
 * The rule for everything under `/assets/{id}` that only a vehicle has. A read of an asset that is
 * no vehicle is a 404, like a missing asset: there is nothing of the sort to show.
 */
export function assertVehicleForRead(db: Db, assetId: string): void {
  if (kindOf(db, assetId) !== "vehicle") throw notFound("Vehicle");
}

/**
 * A write to an asset that is no vehicle is a 400 `invalid_request`: the request is well formed
 * but asks that asset for something it cannot have. A missing asset is a 404 for both.
 */
export function assertVehicleForWrite(
  db: Db,
  assetId: string,
  what: string,
): void {
  if (kindOf(db, assetId) !== "vehicle") {
    throw new ApiError("invalid_request", `Only vehicles have ${what}`);
  }
}
