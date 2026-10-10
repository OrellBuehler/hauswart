import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { OdometerUnit } from "$lib/api/enums";
import type {
  OdometerSummary,
  VehicleSummary,
} from "$lib/api/schemas/vehicles";
import { odometerReadings, vehicleDetails, type DB } from "$lib/server/db";

/** The order of readings in time: by date, then by when they were entered. Newest first when descending. */
export const readingOrder = (direction: "asc" | "desc") => {
  const by = direction === "asc" ? asc : desc;
  return [
    by(odometerReadings.date),
    by(odometerReadings.createdAt),
    by(sql`${odometerReadings}.rowid`),
  ];
};

/** The unit a vehicle's odometer counts in; kilometres until its details say otherwise. */
export function odometerUnitOf(
  db: Pick<DB, "select">,
  assetId: string,
): OdometerUnit {
  return (
    db
      .select({ unit: vehicleDetails.odometerUnit })
      .from(vehicleDetails)
      .where(eq(vehicleDetails.assetId, assetId))
      .get()?.unit ?? "km"
  );
}

/** The newest reading of a vehicle: the latest date, and among readings of one date the one entered last. */
export function latestReading(db: Pick<DB, "select">, assetId: string) {
  return db
    .select()
    .from(odometerReadings)
    .where(eq(odometerReadings.assetId, assetId))
    .orderBy(...readingOrder("desc"))
    .limit(1)
    .get();
}

/** The newest reading with its unit, as lists and details show it. */
export function odometerSummary(
  db: Pick<DB, "select">,
  assetId: string,
  unit: OdometerUnit = odometerUnitOf(db, assetId),
): OdometerSummary | null {
  const reading = latestReading(db, assetId);
  return reading ? { value: reading.value, date: reading.date, unit } : null;
}

/** Plate and newest reading of the given vehicles, by asset id; one small query per vehicle (there are few). */
export function vehicleSummaries(
  db: Pick<DB, "select">,
  assetIds: readonly string[],
): Map<string, VehicleSummary> {
  const out = new Map<string, VehicleSummary>();
  if (assetIds.length === 0) return out;
  const details = new Map(
    db
      .select({
        assetId: vehicleDetails.assetId,
        plate: vehicleDetails.plate,
        unit: vehicleDetails.odometerUnit,
      })
      .from(vehicleDetails)
      .where(inArray(vehicleDetails.assetId, [...assetIds]))
      .all()
      .map((row) => [row.assetId, row]),
  );
  for (const assetId of assetIds) {
    const row = details.get(assetId);
    out.set(assetId, {
      plate: row?.plate ?? null,
      odometer: odometerSummary(db, assetId, row?.unit ?? "km"),
    });
  }
  return out;
}
