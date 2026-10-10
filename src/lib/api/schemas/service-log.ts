import { z } from "zod";
import { SERVICE_LOG_KINDS } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";
import { minorAmountSchema } from "./fields";
import { currencySchema } from "./household";
import { costsOfSchema } from "./costs";
import { odometerValueSchema } from "./vehicles";

export const serviceLogKindSchema = z.enum(SERVICE_LOG_KINDS);

export const serviceLogEntrySchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    assetName: z.string(),
    date: dateSchema,
    kind: serviceLogKindSchema,
    title: z.string(),
    descriptionMd: z.string(),
    contactId: z.string().nullable(),
    contactName: z.string().nullable(),
    completionId: z.string().nullable(),
    costMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    costEntryId: z.string().nullable(),
    /** Cost entries booked against this entry (household currency); see `/costs?...`. */
    costs: costsOfSchema,
    /** The odometer when the work was done (vehicles only); it is also a reading of the vehicle. */
    odometer: z.number().nullable(),
    performedBy: z.string().nullable(),
    createdBy: z.string().nullable(),
    commentCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "ServiceLogEntry" });
export type ServiceLogEntry = z.infer<typeof serviceLogEntrySchema>;

export const listServiceLogQuerySchema = paginationQuerySchema.extend({
  assetId: idSchema.optional(),
  kind: serviceLogKindSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});
export const listAssetServiceLogQuerySchema = paginationQuerySchema.extend({
  kind: serviceLogKindSchema.optional(),
});
export const listServiceLogResponseSchema = paginated(serviceLogEntrySchema);

/** How many notes one service log entry can resolve (see `/assets/{id}/notes`). */
export const MAX_RESOLVED_NOTES = 50;
const resolvedNoteIds = z.array(idSchema).max(MAX_RESOLVED_NOTES);

const logFields = {
  date: dateSchema,
  kind: serviceLogKindSchema,
  title: z.string().trim().min(1).max(200),
  descriptionMd: z.string().max(50_000),
  contactId: idSchema.nullable(),
  costMinor: minorAmountSchema.nullable(),
  currency: currencySchema.nullable(),
  odometer: odometerValueSchema.nullable(),
  performedBy: nullableText(160),
};

/**
 * `date` defaults to today, `currency` to the household's when a cost is given. An `odometer` (vehicles
 * only, 400 on any other asset) is also recorded as a reading of the vehicle on the entry's date.
 */
export const createServiceLogRequestSchema = z.strictObject({
  date: logFields.date.optional(),
  kind: logFields.kind.default("maintenance"),
  title: logFields.title,
  descriptionMd: logFields.descriptionMd.default(""),
  contactId: logFields.contactId.optional(),
  costMinor: logFields.costMinor.optional(),
  currency: logFields.currency.optional(),
  odometer: logFields.odometer.optional(),
  performedBy: logFields.performedBy.optional(),
  /** Notes of this asset the entry addresses: they become resolved with this entry. Another asset's note or an unknown id is a 400. */
  resolvedNoteIds: resolvedNoteIds.optional(),
});
export type CreateServiceLogRequest = z.output<
  typeof createServiceLogRequestSchema
>;

export const updateServiceLogRequestSchema = atLeastOne(
  z.strictObject({
    date: logFields.date.optional(),
    kind: logFields.kind.optional(),
    title: logFields.title.optional(),
    descriptionMd: logFields.descriptionMd.optional(),
    contactId: logFields.contactId.optional(),
    costMinor: logFields.costMinor.optional(),
    currency: logFields.currency.optional(),
    odometer: logFields.odometer.optional(),
    performedBy: logFields.performedBy.optional(),
    /** Notes of this asset the entry addresses, added to those it resolved already; open notes become resolved with this entry, resolved ones stay as they are. */
    resolvedNoteIds: resolvedNoteIds.optional(),
  }),
);
export type UpdateServiceLogRequest = z.output<
  typeof updateServiceLogRequestSchema
>;

export const serviceLogParamsSchema = z.object({
  id: idSchema,
  entryId: idSchema,
});

/** Optionally sent with `POST /tasks/{id}/complete` to also log the work on the task's asset. */
export const completionServiceLogSchema = z.strictObject({
  kind: serviceLogKindSchema.default("maintenance"),
  title: logFields.title.optional(),
  descriptionMd: logFields.descriptionMd.optional(),
  contactId: logFields.contactId.optional(),
  costMinor: logFields.costMinor.optional(),
  /** Notes of the task's asset this work addressed: they become resolved with the entry, and open again if the completion is undone. */
  resolvedNoteIds: resolvedNoteIds.optional(),
});
export type CompletionServiceLogRequest = z.output<
  typeof completionServiceLogSchema
>;
