import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { OdometerUnit } from "$lib/api/enums";
import type {
  OdometerSummary,
  VehicleSummary,
} from "$lib/api/schemas/vehicles";
import { odometerReadings, vehicleDetails, type DB } from "$lib/server/db";
import { plateKey } from "$lib/vehicles/plate";

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

/**
 * The newest reading on or before a date (`YYYY-MM-DD`): the latest date up to it, and among
 * readings of that date the one entered last. What the odometer showed as of that day.
 */
export function readingOnOrBefore(
  db: Pick<DB, "select">,
  assetId: string,
  date: string,
) {
  return db
    .select()
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.assetId, assetId),
        lte(odometerReadings.date, date),
      ),
    )
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

/**
 * The vehicles whose plate contains `text`, by asset id. Both sides go through `plateKey`, so case,
 * spaces, dots, dashes and any other punctuation do not matter ("zh 000.000" finds "ZH 000000").
 * Compared here and not in SQL, which could only strip the characters it was told about; there are few
 * plates. Text with nothing in it but punctuation matches nothing.
 */
export function vehiclesWithPlateLike(
  db: Pick<DB, "select">,
  text: string,
): string[] {
  const wanted = plateKey(text);
  if (wanted === "") return [];
  return db
    .select({ assetId: vehicleDetails.assetId, plate: vehicleDetails.plate })
    .from(vehicleDetails)
    .where(isNotNull(vehicleDetails.plate))
    .all()
    .filter((row) => plateKey(row.plate ?? "").includes(wanted))
    .map((row) => row.assetId);
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
