import { and, eq, gt, gte, lt, lte, or, type SQL } from "drizzle-orm";
import type { AppointmentStatus } from "$lib/api/enums";
import { pinnableOccurrenceKey } from "$lib/appointments/occurrence";
import {
  defaultEnd,
  endInstant,
  startInstant,
  whenProblem,
  type AppointmentWhen,
} from "$lib/appointments/when";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { commentCountSql } from "$lib/server/comments/counts";
import { householdTimeZone } from "$lib/server/config";
import {
  appointments,
  assets,
  contacts,
  taskState,
  tasks,
  type DB,
} from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type AppointmentRow = typeof appointments.$inferSelect;

export interface AppointmentRecord extends AppointmentRow {
  taskTitle: string | null;
  assetName: string | null;
  contactName: string | null;
  commentCount: number;
}

const selectAppointments = (db: DB) =>
  db
    .select({
      appointment: appointments,
      taskTitle: tasks.title,
      assetName: assets.name,
      contactName: contacts.name,
      commentCount: commentCountSql("appointment", appointments.id),
    })
    .from(appointments)
    .leftJoin(tasks, eq(tasks.id, appointments.taskId))
    .leftJoin(assets, eq(assets.id, appointments.assetId))
    .leftJoin(contacts, eq(contacts.id, appointments.contactId));

type Joined = {
  appointment: AppointmentRow;
  taskTitle: string | null;
  assetName: string | null;
  contactName: string | null;
  commentCount: number;
};

const toRecord = (j: Joined): AppointmentRecord => ({
  ...j.appointment,
  // The occurrence belongs to the task: once the task is gone it means nothing.
  occurrenceKey: j.appointment.taskId ? j.appointment.occurrenceKey : null,
  taskTitle: j.taskTitle,
  assetName: j.assetName,
  contactName: j.contactName,
  commentCount: Number(j.commentCount),
});

/** The `when` a stored row describes (the CHECK constraint guarantees the fields of its kind). */
export function whenOf(row: AppointmentRow): AppointmentWhen {
  return row.allDay
    ? { allDay: true, startDate: row.startDate!, endDate: row.endDate! }
    : {
        allDay: false,
        startsAt: row.startsAt!.getTime(),
        endsAt: row.endsAt!.getTime(),
      };
}

const columnsOf = (when: AppointmentWhen) =>
  when.allDay
    ? {
        allDay: true,
        startDate: when.startDate,
        endDate: when.endDate,
        startsAt: null,
        endsAt: null,
      }
    : {
        allDay: false,
        startDate: null,
        endDate: null,
        startsAt: new Date(when.startsAt),
        endsAt: new Date(when.endsAt),
      };

export interface AppointmentFilter {
  /** `YYYY-MM-DD`; appointments that end on or after this day. */
  from?: string;
  /** `YYYY-MM-DD`; appointments that start on or before this day. */
  to?: string;
  assetId?: string;
  taskId?: string;
  contactId?: string;
  status?: AppointmentStatus;
}

/**
 * Soonest first (an all-day appointment counts from midnight of its first day in the household
 * zone), then the longer one, title and id. `from`/`to` are days in the household zone: a timed
 * appointment is in the range when it overlaps one of those days.
 */
export function listAppointments(
  ctx: Db,
  filter: AppointmentFilter,
  page: { cursor?: string; limit: number },
) {
  const zone = householdTimeZone();
  const where: SQL[] = [];
  if (filter.status) where.push(eq(appointments.status, filter.status));
  if (filter.assetId) where.push(eq(appointments.assetId, filter.assetId));
  if (filter.taskId) where.push(eq(appointments.taskId, filter.taskId));
  if (filter.contactId) {
    where.push(eq(appointments.contactId, filter.contactId));
  }
  if (filter.from) {
    const start = startInstant(
      { allDay: true, startDate: filter.from, endDate: filter.from },
      zone,
    );
    where.push(
      or(
        and(
          eq(appointments.allDay, true),
          gte(appointments.endDate, filter.from),
        ),
        and(
          eq(appointments.allDay, false),
          gt(appointments.endsAt, new Date(start)),
        ),
      ) as SQL,
    );
  }
  if (filter.to) {
    const end = endInstant(
      { allDay: true, startDate: filter.to, endDate: filter.to },
      zone,
    );
    where.push(
      or(
        and(
          eq(appointments.allDay, true),
          lte(appointments.startDate, filter.to),
        ),
        and(
          eq(appointments.allDay, false),
          lt(appointments.startsAt, new Date(end)),
        ),
      ) as SQL,
    );
  }
  const rows = selectAppointments(ctx.db)
    .where(and(...where))
    .all()
    .map(toRecord)
    .map((record) => {
      const when = whenOf(record);
      return {
        record,
        start: startInstant(when, zone),
        end: endInstant(when, zone),
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        a.record.title.localeCompare(b.record.title, "de") ||
        a.record.id.localeCompare(b.record.id),
    )
    .map((x) => x.record);
  return paginateArray(rows, page.cursor, page.limit);
}

export function getAppointment(ctx: Db, id: string): AppointmentRecord {
  const row = selectAppointments(ctx.db).where(eq(appointments.id, id)).get();
  if (!row) throw notFound("Appointment");
  return toRecord(row);
}

function assertRefs(
  ctx: Db,
  refs: {
    taskId?: string | null;
    assetId?: string | null;
    contactId?: string | null;
  },
) {
  const check = (
    table: typeof tasks | typeof assets | typeof contacts,
    id: string | null | undefined,
    field: string,
    label: string,
  ) => {
    if (!id) return;
    const hit = ctx.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .get();
    if (!hit) throw invalidField(field, `${label} does not exist`);
  };
  check(tasks, refs.taskId, "taskId", "Task");
  check(assets, refs.assetId, "assetId", "Asset");
  check(contacts, refs.contactId, "contactId", "Contact");
}

/**
 * The occurrence a task shows now, to pin on an appointment that gets the task: completing the
 * appointment then settles exactly that one, however the task moves on. Null for a task that shows
 * none (the engine's placeholders) or that has not been evaluated.
 */
function shownOccurrence(ctx: Db, taskId: string): string | null {
  const state = ctx.db
    .select({ occurrenceKey: taskState.occurrenceKey })
    .from(taskState)
    .where(eq(taskState.taskId, taskId))
    .get();
  return pinnableOccurrenceKey(state?.occurrenceKey);
}

/** The request's `when` fields as the service takes them: instants in ms, dates as `YYYY-MM-DD`. */
interface WhenFields {
  startsAt?: number;
  endsAt?: number;
  startDate?: string;
  endDate?: string;
}

const hasTimed = (f: WhenFields) =>
  f.startsAt !== undefined || f.endsAt !== undefined;
const hasDated = (f: WhenFields) =>
  f.startDate !== undefined || f.endDate !== undefined;

/** A whole `when` from the fields of one kind; the end defaults to an hour later / the same day. */
function freshWhen(allDay: boolean, f: WhenFields): AppointmentWhen {
  if (allDay) {
    if (hasTimed(f)) {
      throw invalidField("startsAt", "Not allowed for an all-day appointment.");
    }
    if (f.startDate === undefined) {
      throw invalidField("startDate", "Required for an all-day appointment.");
    }
    return {
      allDay: true,
      startDate: f.startDate,
      endDate: f.endDate ?? f.startDate,
    };
  }
  if (hasDated(f)) {
    throw invalidField(
      "startDate",
      "Only for an all-day appointment: set allDay to true.",
    );
  }
  if (f.startsAt === undefined) {
    throw invalidField("startsAt", "Required for a timed appointment.");
  }
  return {
    allDay: false,
    startsAt: f.startsAt,
    endsAt: f.endsAt ?? defaultEnd(f.startsAt),
  };
}

function checked(when: AppointmentWhen): AppointmentWhen {
  const problem = whenProblem(when);
  if (problem) throw invalidField(problem.field, problem.message);
  return when;
}

export interface CreateAppointmentInput extends WhenFields {
  title: string;
  notes?: string | null;
  location?: string | null;
  allDay?: boolean;
  taskId?: string | null;
  /** Defaults to the asset of the task. */
  assetId?: string | null;
  contactId?: string | null;
  occurrenceKey?: string | null;
}

/** Always `planned`; `createdBy` is the person behind the request, null for the system. */
export function createAppointment(
  ctx: ServiceContext,
  input: CreateAppointmentInput,
  createdBy: string | null,
): AppointmentRecord {
  assertRefs(ctx, input);
  const when = checked(freshWhen(input.allDay ?? false, input));
  const taskId = input.taskId ?? null;
  if (input.occurrenceKey != null && taskId === null) {
    throw invalidField("occurrenceKey", "Needs a taskId.");
  }
  const occurrenceKey = taskId
    ? (pinnableOccurrenceKey(input.occurrenceKey) ??
      shownOccurrence(ctx, taskId))
    : null;
  let assetId = input.assetId;
  if (assetId === undefined && taskId) {
    assetId =
      ctx.db
        .select({ assetId: tasks.assetId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()?.assetId ?? null;
  }
  const now = new Date(ctx.now);
  const row = ctx.db
    .insert(appointments)
    .values({
      title: input.title,
      notes: input.notes ?? null,
      location: input.location ?? null,
      ...columnsOf(when),
      taskId,
      occurrenceKey,
      assetId: assetId ?? null,
      contactId: input.contactId ?? null,
      status: "planned",
      createdByUserId: createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: appointments.id })
    .get();
  return getAppointment(ctx, row.id);
}

export interface UpdateAppointmentInput extends WhenFields {
  title?: string;
  notes?: string | null;
  location?: string | null;
  /** Switches the kind; the new kind's start is then required. */
  allDay?: boolean;
  taskId?: string | null;
  assetId?: string | null;
  contactId?: string | null;
  occurrenceKey?: string | null;
  status?: AppointmentStatus;
}

/** The `when` after a patch: the fields given replace those of the stored kind; another kind starts afresh. */
function patchedWhen(
  current: AppointmentRow,
  patch: UpdateAppointmentInput,
): AppointmentWhen {
  const allDay = patch.allDay ?? current.allDay;
  if (allDay !== current.allDay) return freshWhen(allDay, patch);
  const stored = whenOf(current);
  if (stored.allDay) {
    if (hasTimed(patch)) {
      throw invalidField(
        "startsAt",
        "Not allowed for an all-day appointment: set allDay to false to make it a timed one.",
      );
    }
    return {
      allDay: true,
      startDate: patch.startDate ?? stored.startDate,
      endDate: patch.endDate ?? stored.endDate,
    };
  }
  if (hasDated(patch)) {
    throw invalidField(
      "startDate",
      "Only for an all-day appointment: set allDay to true to make this one.",
    );
  }
  return {
    allDay: false,
    startsAt: patch.startsAt ?? stored.startsAt,
    endsAt: patch.endsAt ?? stored.endsAt,
  };
}

/**
 * Changes what is given; the whole stays valid or nothing is written. A change that alters nothing
 * leaves `updatedAt` alone (a calendar sync compares it), anything else, the status included, moves it.
 */
export function updateAppointment(
  ctx: ServiceContext,
  id: string,
  patch: UpdateAppointmentInput,
): AppointmentRecord {
  const current = getAppointment(ctx, id);
  assertRefs(ctx, patch);
  const when = checked(patchedWhen(current, patch));

  const taskId = patch.taskId !== undefined ? patch.taskId : current.taskId;
  if (taskId === null && patch.occurrenceKey != null) {
    throw invalidField("occurrenceKey", "Needs a taskId.");
  }
  let occurrenceKey = taskId === null ? null : current.occurrenceKey;
  if (taskId !== null) {
    if (patch.taskId !== undefined && patch.taskId !== current.taskId) {
      // A new task: the occurrence it shows now, unless the request names one.
      occurrenceKey =
        pinnableOccurrenceKey(patch.occurrenceKey) ??
        shownOccurrence(ctx, taskId);
    } else if (patch.occurrenceKey !== undefined) {
      // Null here unpins on purpose (see completeAppointment).
      occurrenceKey = pinnableOccurrenceKey(patch.occurrenceKey);
    }
  }

  const next = {
    title: patch.title ?? current.title,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    location: patch.location !== undefined ? patch.location : current.location,
    ...columnsOf(when),
    taskId,
    occurrenceKey,
    assetId: patch.assetId !== undefined ? patch.assetId : current.assetId,
    contactId:
      patch.contactId !== undefined ? patch.contactId : current.contactId,
    status: patch.status ?? current.status,
  };
  const same = (Object.keys(next) as (keyof typeof next)[]).every((key) => {
    const a = next[key];
    const b = current[key];
    return a instanceof Date
      ? a.getTime() === (b as Date | null)?.getTime()
      : a === b;
  });
  if (same) return current;
  ctx.db
    .update(appointments)
    .set({ ...next, updatedAt: new Date(ctx.now) })
    .where(eq(appointments.id, id))
    .run();
  return getAppointment(ctx, id);
}

/** Removes the appointment with its comments and attachments. Cancel it to keep it. */
export function deleteAppointment(
  ctx: Pick<ServiceContext, "db" | "now">,
  id: string,
): void {
  getAppointment(ctx, id);
  ctx.db.delete(appointments).where(eq(appointments.id, id)).run();
  removeOwnedAttachments(ctx, "appointment", id);
}
