import { z } from "zod";
import { FUEL_UNITS } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";
import {
  MAX_COST_MINOR,
  costSharesInputSchema,
  costSplitModeSchema,
} from "./costs";
import { currencySchema } from "./household";
import { odometerUnitSchema, odometerValueSchema } from "./vehicles";

export const fuelUnitSchema = z.enum(FUEL_UNITS);

/** More than any tank or battery takes. */
export const MAX_FUEL_QUANTITY = 10_000;
const quantitySchema = z.number().finite().positive().max(MAX_FUEL_QUANTITY);
/** Zero is a free charge: the fill is logged and no cost entry is booked. */
const amountSchema = z.number().int().min(0).max(MAX_COST_MINOR);

export const fuelLogSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    date: dateSchema,
    /** What the odometer showed; it is also a reading of the vehicle. */
    odometer: z.number(),
    odometerUnit: odometerUnitSchema,
    quantity: z.number(),
    unit: fuelUnitSchema,
    amountMinor: z.number().int(),
    currency: z.string(),
    fullTank: z.boolean(),
    /** A fill-up before this one is missing from the log, so no consumption is worked out across the gap. */
    missedPrevious: z.boolean(),
    station: z.string().nullable(),
    notes: z.string().nullable(),
    /** The cost entry (category fuel) this fill booked; null for a free charge or after the entry was deleted. */
    costEntryId: z.string().nullable(),
    paidByUserId: z.string().nullable(),
    /** Minor units per litre or kWh: a rate, not an amount (184.7 is 1.847 per litre). */
    pricePerUnitMinor: z.number().nullable(),
    /** The distance since the previous full fill; set on a full fill that closes a stretch only. */
    distance: z.number().nullable(),
    /** Litres or kWh per 100 distance units over that stretch, partial fills included. */
    consumptionPer100: z.number().nullable(),
    /** Minor units per distance unit over that stretch; null when its cost is not known. */
    costPerDistanceMinor: z.number().nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "FuelLog" });
export type FuelLog = z.infer<typeof fuelLogSchema>;

export const listFuelLogsQuerySchema = paginationQuerySchema.extend({
  year: z.coerce.number().int().min(1900).max(2999).optional(),
});
export const listFuelLogsResponseSchema = paginated(fuelLogSchema);

/**
 * `date` defaults to today (never in the future), `unit` to kWh for an electric vehicle and litres
 * otherwise, `currency` to the household's, `fullTank` to true. The booking follows the costs:
 * `paidByUserId` defaults to the caller (null = nobody), `splitMode` to ownership, `shares` only with
 * `custom`.
 */
export const createFuelLogRequestSchema = z.strictObject({
  date: dateSchema.optional(),
  odometer: odometerValueSchema,
  quantity: quantitySchema,
  unit: fuelUnitSchema.optional(),
  amountMinor: amountSchema,
  currency: currencySchema.optional(),
  fullTank: z.boolean().default(true),
  missedPrevious: z.boolean().default(false),
  station: nullableText(120).optional(),
  notes: nullableText(2000).optional(),
  paidByUserId: idSchema.nullable().optional(),
  splitMode: costSplitModeSchema.optional(),
  shares: costSharesInputSchema.optional(),
});
export type CreateFuelLogRequest = z.output<typeof createFuelLogRequestSchema>;

/** The cost entry follows a change of amount, currency, date, station, payer and split. */
export const updateFuelLogRequestSchema = atLeastOne(
  z.strictObject({
    date: dateSchema.optional(),
    odometer: odometerValueSchema.optional(),
    quantity: quantitySchema.optional(),
    unit: fuelUnitSchema.optional(),
    amountMinor: amountSchema.optional(),
    currency: currencySchema.optional(),
    fullTank: z.boolean().optional(),
    missedPrevious: z.boolean().optional(),
    station: nullableText(120).optional(),
    notes: nullableText(2000).optional(),
    paidByUserId: idSchema.nullable().optional(),
    splitMode: costSplitModeSchema.optional(),
    shares: costSharesInputSchema.optional(),
  }),
);
export type UpdateFuelLogRequest = z.output<typeof updateFuelLogRequestSchema>;
