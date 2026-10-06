import { z } from "zod";
import { normalizeHostEntry } from "$lib/hosts";
import { atLeastOne, dateSchema, isoTimestampSchema } from "./common";

export const DEFAULT_DUE_SOON_DAYS = 7;
export const DEFAULT_DIGEST_TIME = "08:00";
export const DEFAULT_DEFECT_DEADLINE_MONTHS = 24;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Expected HH:MM",
});

export const MAX_HOST_ALLOWLIST = 50;

const hostEntrySchema = z
  .string()
  .trim()
  .max(260)
  .refine((v) => normalizeHostEntry(v) !== null, {
    error: "Expected a host name or address, optionally with a port.",
  });

const settingsShape = {
  dueSoonDays: z.number().int().min(0).max(60).default(DEFAULT_DUE_SOON_DAYS),
  digestTime: timeOfDaySchema.default(DEFAULT_DIGEST_TIME),
  /** Months after the handover date within which defects must be reported. */
  defectDeadlineMonths: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(DEFAULT_DEFECT_DEADLINE_MONTHS),
};

const HOST_ALLOWLIST_DOC =
  "Hosts (`host` or `host:port`, normalised) that members may point their own (per-person) integration connections at. Administrators may use any host. Shown to administrators only.";

/** What is stored: the allow-list is always there. */
export const householdSettingsSchema = z.object({
  ...settingsShape,
  integrationHostAllowlist: z
    .array(z.string())
    .max(MAX_HOST_ALLOWLIST)
    .default([]),
});
export type HouseholdSettings = z.infer<typeof householdSettingsSchema>;

/** What the API returns: the allow-list is left out for everybody but administrators. */
export const publicHouseholdSettingsSchema = z
  .object({
    ...settingsShape,
    integrationHostAllowlist: z
      .array(z.string())
      .optional()
      .describe(HOST_ALLOWLIST_DOC),
  })
  .meta({ id: "HouseholdSettings" });

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
    settings: publicHouseholdSettingsSchema,
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
        integrationHostAllowlist: z
          .array(hostEntrySchema)
          .max(MAX_HOST_ALLOWLIST)
          .optional()
          .describe(HOST_ALLOWLIST_DOC),
      })
      .optional(),
  }),
);
export type UpdateHouseholdRequest = z.output<
  typeof updateHouseholdRequestSchema
>;
