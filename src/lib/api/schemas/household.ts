import { z } from "zod";
import { atLeastOne, dateSchema, isoTimestampSchema } from "./common";

export const DEFAULT_DUE_SOON_DAYS = 7;
export const DEFAULT_DIGEST_TIME = "08:00";
export const DEFAULT_DEFECT_DEADLINE_MONTHS = 24;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Expected HH:MM",
});

export const householdSettingsSchema = z
  .object({
    dueSoonDays: z.number().int().min(0).max(60).default(DEFAULT_DUE_SOON_DAYS),
    digestTime: timeOfDaySchema.default(DEFAULT_DIGEST_TIME),
    /** Months after the handover date within which defects must be reported. */
    defectDeadlineMonths: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(DEFAULT_DEFECT_DEADLINE_MONTHS),
  })
  .meta({ id: "HouseholdSettings" });
export type HouseholdSettings = z.infer<typeof householdSettingsSchema>;

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { error: "Expected an ISO 4217 code like CHF." });

export const householdSchema = z
  .object({
    name: z.string(),
    /** Set by `HAUSWART_TZ`; read-only through the API. */
    timezone: z.string(),
    currency: z.string(),
    handoverDate: dateSchema.nullable(),
    settings: householdSettingsSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Household" });
export type Household = z.infer<typeof householdSchema>;

export const updateHouseholdRequestSchema = atLeastOne(
  z.strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    currency: currencySchema.optional(),
    handoverDate: dateSchema.nullable().optional(),
    settings: z
      .strictObject({
        dueSoonDays: z.number().int().min(0).max(60).optional(),
        digestTime: timeOfDaySchema.optional(),
        defectDeadlineMonths: z.number().int().min(1).max(120).optional(),
      })
      .optional(),
  }),
);
export type UpdateHouseholdRequest = z.output<
  typeof updateHouseholdRequestSchema
>;
