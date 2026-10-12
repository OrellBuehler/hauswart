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
    /** The cost book of that cost entry (`GET /cost-books`); null while there is no cost entry. */
    bookId: z.string().nullable(),
    bookName: z.string().nullable(),
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
 * `paidByUserId` defaults to the caller (null = nobody), `shares` only with `custom`. `bookId` is the cost
 * book of the cost entry (an open book, else 400 on `bookId`); without it the vehicle's own book
 * (`costBookId` of its details) applies while that book is open, else the default book. `splitMode`
 * defaults to the split of the book it lands in. A free fill (amount 0) books nothing, so
 * `paidByUserId`, `splitMode`, `shares` and `bookId` mean nothing for it (a bad `bookId` is still refused).
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
  bookId: idSchema.optional(),
  paidByUserId: idSchema.nullable().optional(),
  splitMode: costSplitModeSchema.optional(),
  shares: costSharesInputSchema.optional(),
  /**
   * The receipt task (`/ai-tasks`) the fill is booked for: its cost entry is flagged for review and recorded on the task
   * like `receiptTaskId` of `POST /costs`. A free fill has no cost entry to record it on, so the id is a 400 there.
   */
  receiptTaskId: idSchema.optional(),
});
export type CreateFuelLogRequest = z.output<typeof createFuelLogRequestSchema>;

/**
 * The cost entry follows a change of amount, currency, date, station, payer, split and book. `bookId` moves it to
 * another open book (400 on `bookId` otherwise; the book it is in already is always fine); on a free fill, which has
 * no cost entry, it changes nothing, and a fill that starts costing money in the same request is booked into it.
 */
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
    bookId: idSchema.optional(),
    paidByUserId: idSchema.nullable().optional(),
    splitMode: costSplitModeSchema.optional(),
    shares: costSharesInputSchema.optional(),
  }),
);
export type UpdateFuelLogRequest = z.output<typeof updateFuelLogRequestSchema>;
