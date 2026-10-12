import { z } from "zod";
import {
  ODOMETER_REFUSAL_CODES,
  ODOMETER_SOURCES,
  ODOMETER_UNITS,
  VEHICLE_FUEL_TYPES,
} from "../enums";
import {
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";

export const odometerUnitSchema = z.enum(ODOMETER_UNITS);
export const vehicleFuelTypeSchema = z.enum(VEHICLE_FUEL_TYPES);
export const odometerSourceSchema = z.enum(ODOMETER_SOURCES);

/** More than any odometer shows; keeps a typo of a few extra digits out. */
export const MAX_ODOMETER_VALUE = 10_000_000;
export const odometerValueSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_ODOMETER_VALUE);

/**
 * What the `details` of a refused reading carry besides `body.fieldErrors` (whose message stays English
 * text): `code` says why, `field` is the request field the 400 is reported on (`value` for a reading,
 * `odometer` for a fuel log entry, tire change or service log entry, `counterValue` for a completion),
 * `reading` the neighbouring reading that is in the way (the one before for `lower_than_previous`, the one
 * after for `higher_than_next`). Sending `force: true` where the endpoint takes it lifts the refusal.
 */
export const odometerRefusalDetailsSchema = z.object({
  code: z.enum(ODOMETER_REFUSAL_CODES),
  field: z.string(),
  reading: z.object({ value: z.number(), date: dateSchema }),
});
export type OdometerRefusalDetails = z.infer<
  typeof odometerRefusalDetailsSchema
>;

/** The newest reading of a vehicle (by date). */
export const odometerSummarySchema = z
  .object({
    value: z.number(),
    date: dateSchema,
    unit: odometerUnitSchema,
  })
  .meta({ id: "OdometerSummary" });
export type OdometerSummary = z.infer<typeof odometerSummarySchema>;

/** What lists of assets show of a vehicle. */
export const vehicleSummarySchema = z
  .object({
    plate: z.string().nullable(),
    odometer: odometerSummarySchema.nullable(),
  })
  .meta({ id: "VehicleSummary" });
export type VehicleSummary = z.infer<typeof vehicleSummarySchema>;

export const vehicleSchema = z
  .object({
    assetId: z.string(),
    /** Kennzeichen. */
    plate: z.string().nullable(),
    vin: z.string().nullable(),
    /** The Swiss "Stammnummer". */
    registrationNumber: z.string().nullable(),
    firstRegistration: dateSchema.nullable(),
    fuelType: vehicleFuelTypeSchema.nullable(),
    tireSizeSummer: z.string().nullable(),
    tireSizeWinter: z.string().nullable(),
    /** Where the vehicle is kept, free text. */
    location: z.string().nullable(),
    odometerUnit: odometerUnitSchema,
    notes: z.string().nullable(),
    /**
     * The cost book (`GET /cost-books`) the fuel fills of this vehicle are booked into when a fill names none; null =
     * the default book. It is also used only while that book is not archived.
     */
    costBookId: z.string().nullable(),
    /** The newest odometer reading; null before the first. */
    odometer: odometerSummarySchema.nullable(),
    /** Null while the details were never saved (the other fields then hold the defaults). */
    updatedAt: isoTimestampSchema.nullable(),
  })
  .meta({ id: "Vehicle" });
export type Vehicle = z.infer<typeof vehicleSchema>;

/**
 * `PUT` replaces the details: a field left out is cleared (the unit goes back to km), `costBookId` included. Changing
 * `odometerUnit` only relabels the readings, it does not convert them. `costBookId` must be a book that is open (400
 * on `costBookId` for an unknown or archived one; sending the one the vehicle has already is always fine).
 */
export const putVehicleRequestSchema = z.strictObject({
  plate: nullableText(32).optional(),
  vin: nullableText(32).optional(),
  registrationNumber: nullableText(32).optional(),
  firstRegistration: dateSchema.nullable().optional(),
  fuelType: vehicleFuelTypeSchema.nullable().optional(),
  tireSizeSummer: nullableText(64).optional(),
  tireSizeWinter: nullableText(64).optional(),
  location: nullableText(200).optional(),
  odometerUnit: odometerUnitSchema.optional(),
  notes: nullableText(20_000).optional(),
  costBookId: idSchema.nullable().optional(),
});
export type PutVehicleRequest = z.output<typeof putVehicleRequestSchema>;

export const odometerReadingSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    date: dateSchema,
    value: z.number(),
    /** Who wrote it: a person (`manual`) or the record it came from (`sourceId`). */
    source: odometerSourceSchema,
    sourceId: z.string().nullable(),
    note: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "OdometerReading" });
export type OdometerReading = z.infer<typeof odometerReadingSchema>;

export const listOdometerQuerySchema = paginationQuerySchema;
export const listOdometerResponseSchema = paginated(odometerReadingSchema);

/**
 * A reading lower than the one before it or higher than the one after it (by date) is a 400 on
 * `value`, as a typo would be; `force` takes it anyway (a replaced instrument cluster starts again
 * from a lower number).
 */
export const recordOdometerRequestSchema = z.strictObject({
  /** Defaults to today; never in the future. */
  date: dateSchema.optional(),
  value: odometerValueSchema,
  note: nullableText(500).optional(),
  force: z.boolean().optional(),
});
export type RecordOdometerRequest = z.output<
  typeof recordOdometerRequestSchema
>;
