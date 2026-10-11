import { z } from "zod";
import { TIRE_EVENT_KINDS, TIRE_SEASONS } from "../enums";
import { isValidDot } from "../../vehicles/tires";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";
import { odometerUnitSchema, odometerValueSchema } from "./vehicles";

export const tireSeasonSchema = z.enum(TIRE_SEASONS);
export const tireEventKindSchema = z.enum(TIRE_EVENT_KINDS);

/** The deepest tread of a new tire is about 10 mm. */
export const MAX_TREAD_MM = 20;
export const treadDepthSchema = z.number().finite().min(0).max(MAX_TREAD_MM);

/** The DOT date code, week and year as four digits ("2423" is week 24 of 2023); an empty string clears it. */
const dotSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine((value) => value === null || isValidDot(value), {
    error:
      "Expected the DOT date code: week 01-53 and year as four digits, for example 2423.",
  });

export const tireEventSchema = z
  .object({
    id: z.string(),
    kind: tireEventKindSchema,
    date: dateSchema,
    odometer: z.number().nullable(),
    treadDepthMm: z.number().nullable(),
    createdAt: isoTimestampSchema,
  })
  .meta({ id: "TireSetEvent" });
export type TireEvent = z.infer<typeof tireEventSchema>;

export const tireSetSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    season: tireSeasonSchema,
    brand: z.string().nullable(),
    model: z.string().nullable(),
    size: z.string().nullable(),
    /** Week and year the tires were made. */
    dot: z.string().nullable(),
    /** The latest measurement; every measurement is an event. */
    treadDepthMm: z.number().nullable(),
    treadMeasuredOn: dateSchema.nullable(),
    /** True when the latest measurement is below the limit of the season (3 mm summer, 4 mm winter and all-season). */
    treadWarning: z.boolean(),
    /** From the DOT code, to one decimal; null without a valid code. */
    ageYears: z.number().nullable(),
    storageLocation: z.string().nullable(),
    storageContactId: z.string().nullable(),
    storageContactName: z.string().nullable(),
    mounted: z.boolean(),
    /** The day the set was mounted; null while it is not. */
    mountedOn: dateSchema.nullable(),
    purchasedOn: dateSchema.nullable(),
    /** Retired sets are left out of lists unless asked for and cannot be mounted. */
    retiredAt: isoTimestampSchema.nullable(),
    notes: z.string().nullable(),
    /** Distance driven on the set, from its mount and unmount events and the odometer readings; null when it was mounted but nothing can be measured. */
    distance: z.number().nullable(),
    odometerUnit: odometerUnitSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "TireSet" });
export type TireSet = z.infer<typeof tireSetSchema>;

export const tireSetDetailSchema = tireSetSchema
  .extend({ events: z.array(tireEventSchema) })
  .meta({ id: "TireSetDetail" });
export type TireSetDetail = z.infer<typeof tireSetDetailSchema>;

export const listTireSetsQuerySchema = paginationQuerySchema.extend({
  includeRetired: queryBooleanSchema.optional(),
});
export const listTireSetsResponseSchema = paginated(tireSetSchema);

export const tireSetMountParamsSchema = z.object({
  id: idSchema,
  setId: idSchema,
});

const setFields = {
  season: tireSeasonSchema,
  brand: nullableText(80),
  model: nullableText(80),
  size: nullableText(40),
  dot: dotSchema,
  storageLocation: nullableText(200),
  storageContactId: idSchema.nullable(),
  purchasedOn: dateSchema.nullable(),
  notes: nullableText(5000),
};

/**
 * A new set is not mounted; mount it with `POST .../mount`. A first tread measurement is stored as the
 * first measurement event (`treadMeasuredOn` defaults to today).
 */
export const createTireSetRequestSchema = z.strictObject({
  season: setFields.season,
  brand: setFields.brand.optional(),
  model: setFields.model.optional(),
  size: setFields.size.optional(),
  dot: setFields.dot.optional(),
  treadDepthMm: treadDepthSchema.optional(),
  treadMeasuredOn: dateSchema.optional(),
  storageLocation: setFields.storageLocation.optional(),
  storageContactId: setFields.storageContactId.optional(),
  purchasedOn: setFields.purchasedOn.optional(),
  notes: setFields.notes.optional(),
});
export type CreateTireSetRequest = z.output<typeof createTireSetRequestSchema>;

/**
 * Whether a set is mounted and its tread change through `mount` and `tread` only. `retired: true` takes
 * a mounted set off first.
 */
export const updateTireSetRequestSchema = atLeastOne(
  z.strictObject({
    season: setFields.season.optional(),
    brand: setFields.brand.optional(),
    model: setFields.model.optional(),
    size: setFields.size.optional(),
    dot: setFields.dot.optional(),
    storageLocation: setFields.storageLocation.optional(),
    storageContactId: setFields.storageContactId.optional(),
    purchasedOn: setFields.purchasedOn.optional(),
    notes: setFields.notes.optional(),
    retired: z.boolean().optional(),
  }),
);
export type UpdateTireSetRequest = z.output<typeof updateTireSetRequestSchema>;

/** `date` defaults to today and is never in the future. With an `odometer` the vehicle gets that reading (source `tire_change`). */
export const mountTireSetRequestSchema = z.strictObject({
  date: dateSchema.optional(),
  odometer: odometerValueSchema.optional(),
});
export type MountTireSetRequest = z.output<typeof mountTireSetRequestSchema>;

export const measureTreadRequestSchema = z.strictObject({
  date: dateSchema.optional(),
  treadDepthMm: treadDepthSchema,
  odometer: odometerValueSchema.optional(),
});
export type MeasureTreadRequest = z.output<typeof measureTreadRequestSchema>;
