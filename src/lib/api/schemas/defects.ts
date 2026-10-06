import { z } from "zod";
import {
  DEFECT_DEADLINE_SOURCES,
  DEFECT_EVENT_TYPES,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
} from "../enums";
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
import { costsOfSchema } from "./costs";

export const defectStatusSchema = z.enum(DEFECT_STATUSES);
export const defectSeveritySchema = z.enum(DEFECT_SEVERITIES);
export const defectDeadlineSourceSchema = z.enum(DEFECT_DEADLINE_SOURCES);
export const defectEventTypeSchema = z.enum(DEFECT_EVENT_TYPES);

/** Statuses of a defect that still needs attention. */
export const ACTIVE_DEFECT_STATUSES = [
  "open",
  "reported",
  "in_progress",
] as const;

/** Where a defect may go from each status; closed ones can only be reopened. */
export const DEFECT_TRANSITIONS: Record<
  (typeof DEFECT_STATUSES)[number],
  readonly (typeof DEFECT_STATUSES)[number][]
> = {
  open: ["reported", "in_progress", "fixed", "rejected"],
  reported: ["open", "in_progress", "fixed", "rejected"],
  in_progress: ["open", "reported", "fixed", "rejected"],
  fixed: ["open"],
  rejected: ["open"],
};

export const REMINDER_LEAD_DAYS = 30;

export const defectSchema = z
  .object({
    id: z.string(),
    /** Running number, stable for the life of the defect. */
    number: z.number().int(),
    title: z.string(),
    descriptionMd: z.string(),
    status: defectStatusSchema,
    severity: defectSeveritySchema,
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    locationDetail: z.string().nullable(),
    discoveredOn: dateSchema,
    reportedOn: dateSchema.nullable(),
    responsibleContactId: z.string().nullable(),
    responsibleContactName: z.string().nullable(),
    deadlineDate: dateSchema.nullable(),
    deadlineSource: defectDeadlineSourceSchema,
    fixedOn: dateSchema.nullable(),
    resolutionMd: z.string(),
    costEntryId: z.string().nullable(),
    /** Cost entries booked against this defect (household currency), refunds netted off. */
    costs: costsOfSchema,
    /** The task that reminds the household of the deadline, while there is one. */
    reminderTaskId: z.string().nullable(),
    commentCount: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Defect" });
export type Defect = z.infer<typeof defectSchema>;

export const defectEventSchema = z
  .object({
    id: z.string(),
    defectId: z.string(),
    at: isoTimestampSchema,
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    type: defectEventTypeSchema,
    fromStatus: defectStatusSchema.nullable(),
    toStatus: defectStatusSchema.nullable(),
    bodyMd: z.string(),
    externalRef: z.string().nullable(),
  })
  .meta({ id: "DefectEvent" });
export type DefectEvent = z.infer<typeof defectEventSchema>;

export const defectDetailSchema = defectSchema
  .extend({ events: z.array(defectEventSchema) })
  .meta({ id: "DefectDetail" });
export type DefectDetail = z.infer<typeof defectDetailSchema>;

export const listDefectsQuerySchema = paginationQuerySchema.extend({
  status: defectStatusSchema.optional(),
  /** Only defects that still need attention (open, reported, in progress). */
  active: queryBooleanSchema.optional(),
  severity: defectSeveritySchema.optional(),
  roomId: idSchema.optional(),
  assetId: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export const listDefectsResponseSchema = paginated(defectSchema);

const defectFields = {
  title: z.string().trim().min(1).max(200),
  descriptionMd: z.string().max(50_000),
  severity: defectSeveritySchema,
  roomId: idSchema.nullable(),
  assetId: idSchema.nullable(),
  locationDetail: nullableText(500),
  discoveredOn: dateSchema,
  reportedOn: dateSchema.nullable(),
  responsibleContactId: idSchema.nullable(),
  deadlineDate: dateSchema.nullable(),
  resolutionMd: z.string().max(50_000),
};

/**
 * `discoveredOn` defaults to today. Without `deadlineDate` the deadline is the
 * household's handover date plus its defect deadline months (when a handover
 * date is set); `deadlineDate: null` means no deadline.
 */
export const createDefectRequestSchema = z.strictObject({
  title: defectFields.title,
  descriptionMd: defectFields.descriptionMd.default(""),
  severity: defectFields.severity.default("medium"),
  roomId: defectFields.roomId.optional(),
  assetId: defectFields.assetId.optional(),
  locationDetail: defectFields.locationDetail.optional(),
  discoveredOn: defectFields.discoveredOn.optional(),
  reportedOn: defectFields.reportedOn.optional(),
  responsibleContactId: defectFields.responsibleContactId.optional(),
  deadlineDate: defectFields.deadlineDate.optional(),
});
export type CreateDefectRequest = z.output<typeof createDefectRequestSchema>;

/**
 * Status changes have their own endpoint. `deadlineDate` sets a manual
 * deadline (null: none); `deadlineSource: "handover"` goes back to the
 * deadline derived from the handover date.
 */
export const updateDefectRequestSchema = atLeastOne(
  z
    .strictObject({
      title: defectFields.title.optional(),
      descriptionMd: defectFields.descriptionMd.optional(),
      severity: defectFields.severity.optional(),
      roomId: defectFields.roomId.optional(),
      assetId: defectFields.assetId.optional(),
      locationDetail: defectFields.locationDetail.optional(),
      discoveredOn: defectFields.discoveredOn.optional(),
      reportedOn: defectFields.reportedOn.optional(),
      responsibleContactId: defectFields.responsibleContactId.optional(),
      deadlineDate: defectFields.deadlineDate.optional(),
      deadlineSource: z.literal("handover").optional(),
      fixedOn: dateSchema.nullable().optional(),
      resolutionMd: defectFields.resolutionMd.optional(),
    })
    .refine(
      (v) => !(v.deadlineSource !== undefined && v.deadlineDate !== undefined),
      {
        error: "Give either deadlineDate or deadlineSource.",
        path: ["deadlineSource"],
      },
    ),
);
export type UpdateDefectRequest = z.output<typeof updateDefectRequestSchema>;

/** `reportedOn` / `fixedOn` default to today when moving to `reported` / `fixed`. */
export const changeDefectStatusRequestSchema = z.strictObject({
  status: defectStatusSchema,
  note: z.string().trim().max(10_000).optional(),
  reportedOn: dateSchema.optional(),
  fixedOn: dateSchema.optional(),
});
export type ChangeDefectStatusRequest = z.output<
  typeof changeDefectStatusRequestSchema
>;

/** Notes on letters sent and received (the text is the note, the reference an optional link). */
export const addDefectEventRequestSchema = z.strictObject({
  type: z.literal("correspondence"),
  bodyMd: z.string().trim().min(1).max(10_000),
  externalRef: z.string().trim().min(1).max(255).optional(),
});
export type AddDefectEventRequest = z.output<
  typeof addDefectEventRequestSchema
>;

const timelineEventSchema = z.object({
  kind: z.literal("event"),
  id: z.string(),
  at: isoTimestampSchema,
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  type: defectEventTypeSchema,
  fromStatus: defectStatusSchema.nullable(),
  toStatus: defectStatusSchema.nullable(),
  bodyMd: z.string(),
  externalRef: z.string().nullable(),
});

const timelineCommentSchema = z.object({
  kind: z.literal("comment"),
  id: z.string(),
  at: isoTimestampSchema,
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  /** Empty for a deleted comment. */
  bodyMd: z.string(),
  editedAt: isoTimestampSchema.nullable(),
  deleted: z.boolean(),
});

/** Events and comments of one defect, oldest first. */
export const defectTimelineItemSchema = z
  .discriminatedUnion("kind", [timelineEventSchema, timelineCommentSchema])
  .meta({ id: "DefectTimelineItem" });
export type DefectTimelineItem = z.infer<typeof defectTimelineItemSchema>;
export const defectTimelineResponseSchema = z.object({
  items: z.array(defectTimelineItemSchema),
});

export const exportDefectsQuerySchema = z.object({
  status: defectStatusSchema.optional(),
  roomId: idSchema.optional(),
});
export type ExportDefectsQuery = z.output<typeof exportDefectsQuerySchema>;
