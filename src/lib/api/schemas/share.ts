import { z } from "zod";
import {
  FEED_SCOPES,
  GUEST_LINK_STATUSES,
  GUEST_SECTIONS,
  USER_LOCALES,
} from "../enums";
import { atLeastOne, idSchema, isoTimestampSchema, paginated } from "./common";
import { contactSchema } from "./contacts";
import { hintKindSchema } from "./hints";
import { insuranceTypeSchema } from "./insurance";
import { docSectionSchema } from "./docs";

export const FEED_NAME_MAX = 64;
export const MAX_FEEDS_PER_USER = 10;
export const MAX_ALARM_DAYS_BEFORE = 30;

const feedScopeSchema = z.enum(FEED_SCOPES);
const localeSchema = z.enum(USER_LOCALES);
const alarmTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Expected HH:MM" });

export const calendarFeedSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scope: feedScopeSchema,
    includeEstimated: z.boolean(),
    includePreparations: z.boolean(),
    includeDefects: z.boolean(),
    includeWarranties: z.boolean(),
    alarmTime: z.string().nullable(),
    alarmDaysBefore: z.number().int(),
    locale: localeSchema,
    /** The subscription address; null only when the stored token cannot be decrypted (rotate it). */
    url: z.string().nullable(),
    lastFetchedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "CalendarFeed" });
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;

export const listCalendarFeedsResponseSchema = paginated(calendarFeedSchema);

const feedFields = {
  name: z.string().trim().min(1).max(FEED_NAME_MAX),
  scope: feedScopeSchema,
  includeEstimated: z.boolean(),
  includePreparations: z.boolean(),
  includeDefects: z.boolean(),
  includeWarranties: z.boolean(),
  alarmTime: alarmTimeSchema.nullable(),
  alarmDaysBefore: z.number().int().min(0).max(MAX_ALARM_DAYS_BEFORE),
  locale: localeSchema,
};

export const createCalendarFeedRequestSchema = z.strictObject({
  name: feedFields.name,
  scope: feedFields.scope.default("mine"),
  includeEstimated: feedFields.includeEstimated.default(false),
  includePreparations: feedFields.includePreparations.default(true),
  includeDefects: feedFields.includeDefects.default(true),
  includeWarranties: feedFields.includeWarranties.default(true),
  alarmTime: feedFields.alarmTime.default(null),
  alarmDaysBefore: feedFields.alarmDaysBefore.default(0),
  locale: feedFields.locale.optional(),
});
export type CreateCalendarFeedRequest = z.output<
  typeof createCalendarFeedRequestSchema
>;

export const updateCalendarFeedRequestSchema = atLeastOne(
  z.strictObject({
    name: feedFields.name.optional(),
    scope: feedFields.scope.optional(),
    includeEstimated: feedFields.includeEstimated.optional(),
    includePreparations: feedFields.includePreparations.optional(),
    includeDefects: feedFields.includeDefects.optional(),
    includeWarranties: feedFields.includeWarranties.optional(),
    alarmTime: feedFields.alarmTime.optional(),
    alarmDaysBefore: feedFields.alarmDaysBefore.optional(),
    locale: feedFields.locale.optional(),
  }),
);
export type UpdateCalendarFeedRequest = z.output<
  typeof updateCalendarFeedRequestSchema
>;

export const MAX_GUEST_LINK_DAYS = 90;
export const GUEST_LABEL_MAX = 80;
export const MAX_GUEST_PAGE_IDS = 50;
export const GUEST_PIN_PATTERN = /^\d{4,8}$/;

const guestSectionSchema = z.enum(GUEST_SECTIONS);
const guestPinSchema = z
  .string()
  .regex(GUEST_PIN_PATTERN, { error: "The PIN has 4 to 8 digits." });
const sectionsSchema = z
  .array(guestSectionSchema)
  .max(GUEST_SECTIONS.length)
  .transform((list) => [...new Set(list)]);
const pageIdsSchema = z
  .array(idSchema)
  .max(MAX_GUEST_PAGE_IDS)
  .transform((list) => [...new Set(list)]);

export const guestLinkSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    status: z.enum(GUEST_LINK_STATUSES),
    createdBy: z.string().nullable(),
    createdByName: z.string().nullable(),
    startsAt: isoTimestampSchema.nullable(),
    expiresAt: isoTimestampSchema,
    revokedAt: isoTimestampSchema.nullable(),
    hasPin: z.boolean(),
    /** Too many wrong PINs: the link stays closed until a member sets the PIN again. */
    pinLocked: z.boolean(),
    includeSecrets: z.boolean(),
    sections: z.array(guestSectionSchema),
    pageIds: z.array(z.string()),
    locale: localeSchema,
    lastViewedAt: isoTimestampSchema.nullable(),
    viewCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "GuestLink" });
export type GuestLink = z.infer<typeof guestLinkSchema>;

/** `url` appears on creation and rotation only: the token is never stored in the clear. */
export const createdGuestLinkSchema = guestLinkSchema
  .extend({ url: z.string() })
  .meta({ id: "CreatedGuestLink" });
export type CreatedGuestLink = z.infer<typeof createdGuestLinkSchema>;

export const listGuestLinksResponseSchema = paginated(guestLinkSchema);

export const createGuestLinkRequestSchema = z.strictObject({
  label: z.string().trim().min(1).max(GUEST_LABEL_MAX),
  startsAt: isoTimestampSchema.nullable().default(null),
  expiresAt: isoTimestampSchema,
  pin: guestPinSchema.nullable().default(null),
  includeSecrets: z.boolean().default(false),
  sections: sectionsSchema.default([...GUEST_SECTIONS]),
  pageIds: pageIdsSchema.default([]),
  locale: localeSchema.optional(),
});
export type CreateGuestLinkRequest = z.output<
  typeof createGuestLinkRequestSchema
>;

export const updateGuestLinkRequestSchema = atLeastOne(
  z.strictObject({
    label: z.string().trim().min(1).max(GUEST_LABEL_MAX).optional(),
    startsAt: isoTimestampSchema.nullable().optional(),
    expiresAt: isoTimestampSchema.optional(),
    pin: guestPinSchema.nullable().optional(),
    includeSecrets: z.boolean().optional(),
    sections: sectionsSchema.optional(),
    pageIds: pageIdsSchema.optional(),
    locale: localeSchema.optional(),
  }),
);
export type UpdateGuestLinkRequest = z.output<
  typeof updateGuestLinkRequestSchema
>;

export const emergencyPageSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    section: docSectionSchema,
    /** Sanitized HTML for members: secret blocks included. */
    renderedHtml: z.string(),
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "EmergencyPage" });

export const emergencyHintSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    bodyMd: z.string(),
    kind: hintKindSchema,
  })
  .meta({ id: "EmergencyHint" });

export const emergencyAssetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    roomName: z.string().nullable(),
    pinnedHints: z.array(emergencyHintSchema),
  })
  .meta({ id: "EmergencyAsset" });

export const emergencyInsuranceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    type: insuranceTypeSchema,
    /** The insurer's name and phone, from its contact. */
    insurerName: z.string().nullable(),
    insurerPhone: z.string().nullable(),
    policyNumber: z.string().nullable(),
    /** The line to call when something happens (breakdown service, claims). */
    assistancePhone: z.string().nullable(),
  })
  .meta({ id: "EmergencyInsurance" });

export const emergencySchema = z
  .object({
    household: z.object({ name: z.string() }),
    pages: z.array(emergencyPageSchema),
    contacts: z.array(contactSchema),
    assets: z.array(emergencyAssetSchema),
    /** Active policies marked "show on emergency page". Members only: guest links never show them. */
    insurance: z.array(emergencyInsuranceSchema),
  })
  .meta({ id: "Emergency" });
export type Emergency = z.infer<typeof emergencySchema>;

export const exportEmergencyQuerySchema = z.object({
  /** `1` or `true`: also print the secret blocks of the pages and hints. */
  includeSecrets: z
    .enum(["1", "true", "0", "false"])
    .transform((value) => value === "1" || value === "true")
    .optional(),
});
