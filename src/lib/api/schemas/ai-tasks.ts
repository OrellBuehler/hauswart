import { z } from "zod";
import {
  AI_TASK_CLOSED_VIA,
  AI_TASK_KINDS,
  AI_TASK_QUEUEABLE_KINDS,
  AI_TASK_STATUSES,
} from "../enums";
import { attachmentSchema } from "./attachments";
import {
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";

export const aiTaskKindSchema = z.enum(AI_TASK_KINDS);
export const aiTaskStatusSchema = z.enum(AI_TASK_STATUSES);
export const aiTaskClosedViaSchema = z.enum(AI_TASK_CLOSED_VIA);

/** The uploader's own words about the file. */
export const AI_TASK_NOTE_MAX = 1000;
/** Why a task was dismissed. */
export const AI_TASK_REASON_MAX = 500;
/** What the processor wants a person to know about the entries it made. */
export const AI_TASK_RESULT_NOTE_MAX = 2000;
/** The most entries one task can be completed with (a receipt rarely becomes more than a handful). */
export const AI_TASK_MAX_RESULT_IDS = 20;

/** A cost entry a task produced, as it is now; entries deleted since are not listed. */
export const aiTaskCostSchema = z
  .object({
    id: z.string(),
    date: dateSchema,
    title: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    /** Whether a person still has to look at the entry (`POST /costs/{id}/review`). */
    reviewNeeded: z.boolean(),
    /** The fuel log entry that booked this entry, which a task is completed with as `createdFuelLogIds`. */
    fuelLogId: z.string().nullable(),
  })
  .meta({ id: "AiTaskCost" });

export const aiTaskResultSchema = z
  .object({
    /** The cost entries the processor reported, as it reported them (some may be deleted since). */
    createdCostIds: z.array(z.string()),
    /** The fuel log entries it reported; the cost entry each booked is among `costs`. */
    createdFuelLogIds: z.array(z.string()),
    note: z.string().nullable(),
    /** The reported cost entries and those of the reported fuel log entries that still exist. */
    costs: z.array(aiTaskCostSchema),
  })
  .meta({ id: "AiTaskResult" });

export const aiTaskSchema = z
  .object({
    id: z.string(),
    kind: aiTaskKindSchema,
    status: aiTaskStatusSchema,
    /** The uploader's own words about the receipt. */
    note: z.string().nullable(),
    /** The uploader: the default payer of what is booked from the receipt. */
    createdByUserId: z.string().nullable(),
    createdByName: z.string().nullable(),
    /**
     * The uploaded file. While the task is pending it belongs to the task; once it is done the file is the receipt of
     * the cost entry it moved to. Null when somebody deleted the file (or the cost entry it moved to).
     */
    attachment: attachmentSchema.nullable(),
    /** Hints from the uploader: the book and the device the receipt is probably for. */
    bookId: z.string().nullable(),
    bookName: z.string().nullable(),
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    /**
     * The cost entries that exist and were booked for this task (`receiptTaskId` of `POST /costs`, of accepting a finance
     * suggestion and of logging a fill), oldest first, whoever booked them and whatever became of the task. A client that
     * opens a pending task reads this to see what an earlier attempt already booked, and books only the rest.
     */
    bookedSoFar: z.array(aiTaskCostSchema),
    /** Set when the task is done. */
    result: aiTaskResultSchema.nullable(),
    /** Set when the task was dismissed and a reason was given. */
    dismissReason: z.string().nullable(),
    /** When the task left the queue, done or dismissed. */
    completedAt: isoTimestampSchema.nullable(),
    /** How it left the queue: `session` (a person in the web app) or the kind of the API token. */
    completedVia: aiTaskClosedViaSchema.nullable(),
    /**
     * Who closed it, done or dismissed: the person in the web app, or the owner of the API token. Null while the task
     * waits, for a task closed before this was recorded, and once the person is gone.
     */
    completedByUserId: z.string().nullable(),
    completedByName: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "AiTask" });
export type AiTask = z.infer<typeof aiTaskSchema>;

/**
 * Multipart form fields (all values arrive as strings except `file`). `idempotencyKey` (8 to 128 characters, chosen by
 * the caller, unique per person who uploads) makes a retried upload return the first task with status 200 instead of
 * queueing a second; the same key for a different receipt (another file, kind, book or device; the note does not count)
 * is a 409.
 */
export const createAiTaskRequestSchema = z.strictObject({
  file: z.file(),
  kind: z.enum(AI_TASK_QUEUEABLE_KINDS).default("receipt"),
  note: nullableText(AI_TASK_NOTE_MAX).optional(),
  bookId: idSchema.optional(),
  assetId: idSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type CreateAiTaskRequest = z.output<typeof createAiTaskRequestSchema>;

export const listAiTasksQuerySchema = paginationQuerySchema.extend({
  status: aiTaskStatusSchema.optional(),
  kind: aiTaskKindSchema.optional(),
});
export type ListAiTasksQuery = z.output<typeof listAiTasksQuerySchema>;
export const listAiTasksResponseSchema = paginated(aiTaskSchema);

/**
 * Closes a task as done. The entries must exist (400 on the field otherwise); at least one entry is needed: a receipt
 * that produced nothing is dismissed instead. A fuel log entry stands for the cost entry it booked.
 */
export const completeAiTaskRequestSchema = z
  .strictObject({
    createdCostIds: z.array(idSchema).max(AI_TASK_MAX_RESULT_IDS).optional(),
    createdFuelLogIds: z.array(idSchema).max(AI_TASK_MAX_RESULT_IDS).optional(),
    note: nullableText(AI_TASK_RESULT_NOTE_MAX).optional(),
  })
  .refine(
    (v) =>
      (v.createdCostIds?.length ?? 0) + (v.createdFuelLogIds?.length ?? 0) > 0,
    {
      error:
        "Name at least one cost entry or fuel log entry; dismiss the task instead when nothing was booked.",
      path: ["createdCostIds"],
    },
  );
export type CompleteAiTaskRequest = z.output<
  typeof completeAiTaskRequestSchema
>;

export const dismissAiTaskRequestSchema = z.strictObject({
  reason: nullableText(AI_TASK_REASON_MAX).optional(),
});
export type DismissAiTaskRequest = z.output<typeof dismissAiTaskRequestSchema>;

/**
 * Content types of `GET /ai-tasks/{id}/preview`: images are sent as JPEG when they had to be scaled down, else as stored.
 */
export const AI_TASK_PREVIEW_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** The longest side of the scaled copy an assistant reads, in pixels (more for a very long, narrow receipt). */
export const AI_TASK_PREVIEW_MAX_SIDE = 1600;
/** The most bytes of that copy. */
export const AI_TASK_PREVIEW_MAX_BYTES = 1_500_000;
