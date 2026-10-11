import { z } from "zod";
import { APPOINTMENT_STATUSES } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
} from "./common";
import { completionSchema, taskSchema } from "./tasks";
import { whenProblem, type AppointmentWhen } from "../../appointments/when";

export {
  DEFAULT_APPOINTMENT_MINUTES,
  MAX_APPOINTMENT_DAYS,
} from "../../appointments/when";

export const APPOINTMENT_TITLE_MAX = 200;
export const APPOINTMENT_LOCATION_MAX = 300;
export const APPOINTMENT_NOTES_MAX = 5000;

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

/**
 * An appointment is either timed (`allDay` false: `startsAt` and `endsAt`, UTC instants) or all-day
 * (`allDay` true: `startDate` and `endDate`, calendar dates in the household time zone, the last day
 * included); the fields of the other kind are null.
 */
export const appointmentSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** Plain text, no markup. */
    notes: z.string().nullable(),
    location: z.string().nullable(),
    allDay: z.boolean(),
    startsAt: isoTimestampSchema.nullable(),
    endsAt: isoTimestampSchema.nullable(),
    startDate: dateSchema.nullable(),
    endDate: dateSchema.nullable(),
    taskId: z.string().nullable(),
    taskTitle: z.string().nullable(),
    /**
     * The occurrence of the task this is for: the one the task showed when the appointment got the
     * task. Null when the task showed none, or the pin was removed: completing the appointment then
     * settles the occurrence the task shows only if that fell due by the appointment's last day.
     */
    occurrenceKey: z.string().nullable(),
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    contactId: z.string().nullable(),
    contactName: z.string().nullable(),
    status: appointmentStatusSchema,
    commentCount: z.number().int(),
    createdByUserId: z.string().nullable(),
    createdAt: isoTimestampSchema,
    /** Moves with every change, the status included: what a calendar sync compares. */
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Appointment" });
export type Appointment = z.infer<typeof appointmentSchema>;

/**
 * Appointments that overlap `from`..`to` (both days included, household time zone), soonest first;
 * a timed one counts on every day it touches. Without `status` appointments of every status are listed.
 */
export const listAppointmentsQuerySchema = paginationQuerySchema
  .extend({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    assetId: idSchema.optional(),
    taskId: idSchema.optional(),
    contactId: idSchema.optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.to >= q.from, {
    error: "`to` must not be before `from`.",
    path: ["to"],
  });
export type ListAppointmentsQuery = z.output<
  typeof listAppointmentsQuerySchema
>;
export const listAppointmentsResponseSchema = paginated(appointmentSchema);

const fields = {
  title: z.string().trim().min(1).max(APPOINTMENT_TITLE_MAX),
  notes: nullableText(APPOINTMENT_NOTES_MAX),
  location: nullableText(APPOINTMENT_LOCATION_MAX),
  taskId: idSchema.nullable(),
  assetId: idSchema.nullable(),
  contactId: idSchema.nullable(),
  occurrenceKey: z.string().min(1).max(64).nullable(),
};

type Issues = {
  addIssue(issue: { code: "custom"; message: string; path: string[] }): void;
};
type WhenFields = {
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
};

const add = (ctx: Issues, path: string, message: string) =>
  ctx.addIssue({ code: "custom", message, path: [path] });

/** The span of a request that gives both ends; what is missing is left to the create and update checks. */
function checkSpan(v: WhenFields, ctx: Issues) {
  let when: AppointmentWhen | null = null;
  if (v.startsAt !== undefined && v.endsAt !== undefined) {
    when = {
      allDay: false,
      startsAt: Date.parse(v.startsAt),
      endsAt: Date.parse(v.endsAt),
    };
  } else if (v.startDate !== undefined && v.endDate !== undefined) {
    when = { allDay: true, startDate: v.startDate, endDate: v.endDate };
  }
  const problem = when && whenProblem(when);
  if (problem) add(ctx, problem.field, problem.message);
}

/**
 * `allDay` (default false) says which kind it is. A timed appointment needs `startsAt`; `endsAt`
 * defaults to an hour later. An all-day one needs `startDate`; `endDate` defaults to the same day.
 * The fields of the other kind are refused. At most 14 days long. `assetId` defaults to the asset of
 * the task; `occurrenceKey` needs a `taskId` and defaults to the occurrence the task shows now
 * (none for a task that shows none). A new appointment is `planned`.
 */
export const createAppointmentRequestSchema = z
  .strictObject({
    title: fields.title,
    notes: fields.notes.optional(),
    location: fields.location.optional(),
    allDay: z.boolean().default(false),
    startsAt: isoTimestampSchema.optional(),
    endsAt: isoTimestampSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    taskId: fields.taskId.optional(),
    assetId: fields.assetId.optional(),
    contactId: fields.contactId.optional(),
    occurrenceKey: fields.occurrenceKey.optional(),
  })
  .superRefine((v, ctx) => {
    const foreign = v.allDay
      ? (["startsAt", "endsAt"] as const)
      : (["startDate", "endDate"] as const);
    for (const key of foreign) {
      if (v[key] !== undefined) {
        add(
          ctx,
          key,
          v.allDay
            ? "Not allowed for an all-day appointment."
            : "Only for an all-day appointment: set allDay to true.",
        );
      }
    }
    if (v.allDay && v.startDate === undefined) {
      add(ctx, "startDate", "Required for an all-day appointment.");
    }
    if (!v.allDay && v.startsAt === undefined) {
      add(ctx, "startsAt", "Required for a timed appointment.");
    }
    if (v.occurrenceKey != null && v.taskId == null) {
      add(ctx, "occurrenceKey", "Needs a taskId.");
    }
    checkSpan(v, ctx);
  });
export type CreateAppointmentRequest = z.output<
  typeof createAppointmentRequestSchema
>;

/**
 * Changes only what is given. `allDay` switches the kind: then the new kind's start is required
 * (`startsAt` or `startDate`) and its end defaults as on create. Without `allDay` the fields must
 * fit the appointment as it is, and the whole must stay valid (end after start, at most 14 days):
 * moving only the start of an appointment is refused when it would end before the new start. A new
 * `taskId` takes the occurrence that task shows now as the `occurrenceKey`, unless one is given;
 * `occurrenceKey: null` with the same task removes the pin. `status` is any of the three; setting
 * `done` here records the status only, `POST /appointments/{id}/complete` also completes the task.
 */
export const updateAppointmentRequestSchema = atLeastOne(
  z
    .strictObject({
      title: fields.title.optional(),
      notes: fields.notes.optional(),
      location: fields.location.optional(),
      allDay: z.boolean().optional(),
      startsAt: isoTimestampSchema.optional(),
      endsAt: isoTimestampSchema.optional(),
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
      taskId: fields.taskId.optional(),
      assetId: fields.assetId.optional(),
      contactId: fields.contactId.optional(),
      occurrenceKey: fields.occurrenceKey.optional(),
      status: appointmentStatusSchema.optional(),
    })
    .superRefine((v, ctx) => {
      const timed = [v.startsAt, v.endsAt].some((x) => x !== undefined);
      const dated = [v.startDate, v.endDate].some((x) => x !== undefined);
      if (timed && dated) {
        add(
          ctx,
          "startDate",
          "Give either startsAt and endsAt or startDate and endDate, not both.",
        );
      }
      if (v.allDay === true && timed) {
        add(ctx, "startsAt", "Not allowed for an all-day appointment.");
      }
      if (v.allDay === false && dated) {
        add(ctx, "startDate", "Not allowed for a timed appointment.");
      }
      if (v.occurrenceKey != null && v.taskId === null) {
        add(ctx, "occurrenceKey", "Needs a taskId.");
      }
      checkSpan(v, ctx);
    }),
);
export type UpdateAppointmentRequest = z.output<
  typeof updateAppointmentRequestSchema
>;

export const completeAppointmentRequestSchema = z.strictObject({
  /** Goes on the completion of the task. */
  note: nullableText(2000).optional(),
  /** When it was done (backdating the task's completion); defaults to now, never in the future. */
  completedAt: isoTimestampSchema.optional(),
});
export type CompleteAppointmentRequest = z.output<
  typeof completeAppointmentRequestSchema
>;

export const completeAppointmentResponseSchema = z.object({
  appointment: appointmentSchema,
  /** The completion this recorded on the task; null when no task was completed (see `POST /appointments/{id}/complete`). */
  completion: completionSchema.nullable(),
  /** The task after the completion; null without a task. */
  task: taskSchema.nullable(),
  /** True when nothing new was written: the appointment was done already and its completion stands. */
  replayed: z.boolean(),
});
