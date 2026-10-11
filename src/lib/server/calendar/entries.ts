import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type {
  CalendarItemKind,
  FeedScope,
  TaskCategory,
  UserLocale,
} from "$lib/api/enums";
import { endInstant } from "$lib/appointments/when";
import { addDays, diffDays, localDateOf, maxDate } from "$lib/dates";
import { cancellationDeadline } from "$lib/insurance/policy";
import { m } from "$lib/paraglide/messages";
import { householdTimeZone } from "$lib/server/config";
import { whenOf } from "$lib/server/appointments/appointments";
import {
  appointments,
  assets,
  defects,
  insurancePolicies,
  rooms,
  taskState,
  tasks,
} from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { preparationsForTasks } from "$lib/server/tasks/preparations";
import {
  stateToDue,
  toStateRecord,
  type TaskStateRecord,
} from "$lib/server/tasks/state";
import type { IcsEvent } from "./ical";

export const ESTIMATE_HORIZON_DAYS = 45;
export const WARRANTY_HORIZON_DAYS = 365;
/** How long an appointment that is over stays in a calendar (planned but never closed, or done). */
export const APPOINTMENT_LOOKBACK_DAYS = 30;
const DAY_MS = 86_400_000;

type Opts = { locale: UserLocale };

const CATEGORY: Record<TaskCategory, (i: object, o: Opts) => string> = {
  cleaning: m.category_cleaning,
  maintenance: m.category_maintenance,
  filter: m.category_filter,
  plant: m.category_plant,
  waste: m.category_waste,
  inspection: m.category_inspection,
  payment: m.category_payment,
  order: m.category_order,
  warranty: m.category_warranty,
  defect: m.category_defect,
  other: m.category_other,
};

const uidPart = (value: string) => value.replace(/[^A-Za-z0-9:._-]/g, "_");

/**
 * When an entry takes place, in the shape the calendar builder takes: a single date, a span of
 * dates with an exclusive `end`, or a timed event (instants in ms since epoch).
 */
export type EntryDate = IcsEvent["date"];

/**
 * One thing that belongs in a calendar: what the iCal feed turns into an event and what calendar
 * sync pushes into a connected calendar. `kind`, `itemId` and `instance` name it for good (an
 * occurrence of a task is another entry than the next one); `uid` is that name in text form, without
 * a domain. Only titles, places and dates are in it: never notes, task descriptions, comments or
 * anything from a secret block.
 */
export interface CalendarEntry {
  kind: CalendarItemKind;
  itemId: string;
  /** The occurrence of something that comes round (a task), "" for everything else. */
  instance: string;
  /** `task-<id>-<occurrence>`, `appointment-<id>`, ...: stable, safe characters only. */
  uid: string;
  date: EntryDate;
  summary: string;
  description: string;
  location?: string;
  /** Where the item lives in the app (`/tasks/<id>`); the consumer adds the origin. */
  path: string;
  status?: "CONFIRMED" | "TENTATIVE";
  /** Shows as busy (appointments with a time). */
  busy?: boolean;
  /** Whether a reminder belongs to it (not for estimates, nor for appointments that are over). */
  alarmable: boolean;
  /** Epoch milliseconds of the last change of the item itself. */
  lastModified: number;
  categories?: string[];
}

export interface EntryOptions {
  locale: UserLocale;
  /** `mine`: tasks and appointments assigned to `userId` or to nobody. `all`: every one. */
  scope: FeedScope;
  userId: string | null;
  /** Estimated dates (medium confidence, within 45 days) for tasks without a due date, marked tentative. */
  includeEstimated: boolean;
  tasks: boolean;
  preparations: boolean;
  defects: boolean;
  warranties: boolean;
  appointments: boolean;
  insurance: boolean;
  /** Tasks with one of these `externalSource` values are left out: another entry stands for them. */
  skipTaskSources: readonly string[];
}

interface Dated {
  date: string;
  estimated: boolean;
}

/**
 * Where a task shows up: its due date, or (when wanted) a medium-confidence estimate within the
 * next 45 days. Tasks without either, and estimates nobody wants, are not in the calendar.
 */
function datedOf(
  state: TaskStateRecord,
  includeEstimated: boolean,
  today: string,
): Dated | null {
  if (state.dueDate) return { date: state.dueDate, estimated: false };
  const estimate = state.estimate;
  if (
    includeEstimated &&
    estimate &&
    estimate.confidence === "medium" &&
    estimate.date >= today &&
    diffDays(estimate.date, today) <= ESTIMATE_HORIZON_DAYS
  ) {
    return { date: estimate.date, estimated: true };
  }
  return null;
}

/**
 * The entries of a calendar: the next occurrence of every active task the scope covers, plus (as
 * asked) preparations, defect deadlines, warranty ends, appointments and cancellation deadlines of
 * insurance policies. The iCal feed and calendar sync both read this, so they never disagree about
 * what is in a calendar. The result is in no particular order.
 */
export async function readCalendarEntries(
  ctx: ServiceContext,
  options: EntryOptions,
): Promise<CalendarEntry[]> {
  const { today } = clockAt(ctx.now);
  const tz = householdTimeZone();
  const o: Opts = { locale: options.locale };
  const entries: CalendarEntry[] = [];

  const place = (
    asset: string | null,
    room: string | null,
    extra: string[] = [],
  ) =>
    [
      ...(asset ? [m.cal_asset_line({ name: asset }, o)] : []),
      ...(room ? [m.cal_room_line({ name: room }, o)] : []),
      ...extra,
    ].join("\n");

  const rows =
    options.tasks || options.preparations ? readTasks(ctx, options, today) : [];

  const dated = new Map<string, Dated>();
  for (const r of rows) {
    const when = datedOf(r.state, options.includeEstimated, today);
    if (!when) continue;
    dated.set(r.task.id, when);
    if (!options.tasks) continue;
    const room = r.ownRoomName ?? r.assetRoomName;
    const due = stateToDue(r.state);
    const span =
      !when.estimated && due.windowStart && due.windowStart < when.date
        ? { start: due.windowStart, end: addDays(when.date, 1) }
        : null;
    entries.push({
      kind: "task_due",
      itemId: r.task.id,
      instance: r.state.occurrenceKey,
      uid: `task-${uidPart(r.task.id)}-${uidPart(r.state.occurrenceKey)}`,
      date: span ?? when.date,
      summary: `${when.estimated ? "~ " : ""}${r.task.title}`,
      description: place(r.assetName, room, [
        ...(span
          ? [m.cal_window_note({ from: span.start, to: when.date }, o)]
          : []),
        ...(when.estimated ? [m.cal_estimated_note({}, o)] : []),
      ]),
      path: `/tasks/${r.task.id}`,
      status: when.estimated ? "TENTATIVE" : "CONFIRMED",
      alarmable: !when.estimated,
      lastModified: r.task.updatedAt.getTime(),
      categories: [CATEGORY[r.task.category]({}, o)],
    });
  }

  if (options.preparations && dated.size > 0) {
    const states = new Map(
      rows.filter((r) => dated.has(r.task.id)).map((r) => [r.task.id, r.state]),
    );
    const byTask = new Map(rows.map((r) => [r.task.id, r]));
    const preps = await preparationsForTasks(ctx, states);
    for (const [taskId, list] of preps) {
      const r = byTask.get(taskId)!;
      const when = dated.get(taskId)!;
      for (const prep of list) {
        if (prep.state === "done" || prep.state === "in_stock_skip") continue;
        const date =
          prep.leadDays !== null
            ? addDays(when.date, -prep.leadDays)
            : prep.state === "now"
              ? when.date
              : null;
        if (date === null) continue;
        entries.push({
          kind: "preparations",
          itemId: prep.id,
          instance: r.state.occurrenceKey,
          uid: `prep-${uidPart(prep.id)}-${uidPart(r.state.occurrenceKey)}`,
          date,
          summary: `${when.estimated ? "~ " : ""}${m.cal_prep_summary({ title: prep.title }, o)}`,
          description: [
            m.cal_prep_for({ task: r.task.title }, o),
            ...(when.estimated ? [m.cal_estimated_note({}, o)] : []),
          ].join("\n"),
          path: `/tasks/${r.task.id}`,
          status: when.estimated ? "TENTATIVE" : "CONFIRMED",
          alarmable: !when.estimated,
          lastModified: Math.max(
            r.task.updatedAt.getTime(),
            prep.updatedAt.getTime(),
          ),
        });
      }
    }
  }

  if (options.defects) {
    const defectRoom = alias(rooms, "defect_room");
    const open = ctx.db
      .select({
        defect: defects,
        roomName: defectRoom.name,
        assetName: assets.name,
      })
      .from(defects)
      .leftJoin(defectRoom, eq(defectRoom.id, defects.roomId))
      .leftJoin(assets, eq(assets.id, defects.assetId))
      .where(
        and(
          isNotNull(defects.deadlineDate),
          notInArray(defects.status, ["fixed", "rejected"]),
        ),
      )
      .all();
    for (const { defect, roomName, assetName } of open) {
      entries.push({
        kind: "defect_deadlines",
        itemId: defect.id,
        instance: "",
        uid: `defect-${uidPart(defect.id)}-deadline`,
        date: defect.deadlineDate as string,
        summary: m.cal_defect_summary(
          { number: defect.number, title: defect.title },
          o,
        ),
        description: place(assetName, roomName),
        path: `/defects/${defect.id}`,
        alarmable: true,
        lastModified: defect.updatedAt.getTime(),
      });
    }
  }

  if (options.warranties) {
    const until = addDays(today, WARRANTY_HORIZON_DAYS);
    const withWarranty = ctx.db
      .select({ asset: assets, roomName: rooms.name })
      .from(assets)
      .leftJoin(rooms, eq(rooms.id, assets.roomId))
      .where(isNull(assets.archivedAt))
      .all();
    for (const { asset, roomName } of withWarranty) {
      const ends =
        asset.warrantyUntil && asset.warrantyExtendedUntil
          ? maxDate(asset.warrantyUntil, asset.warrantyExtendedUntil)
          : (asset.warrantyUntil ?? asset.warrantyExtendedUntil);
      if (!ends || ends < today || ends > until) continue;
      entries.push({
        kind: "warranty_ends",
        itemId: asset.id,
        instance: "",
        uid: `warranty-${uidPart(asset.id)}`,
        date: ends,
        summary: m.cal_warranty_summary({ name: asset.name }, o),
        description: place(null, roomName, [
          m.cal_warranty_line({ date: ends }, o),
        ]),
        path: `/assets/${asset.id}`,
        alarmable: true,
        lastModified: asset.updatedAt.getTime(),
      });
    }
  }

  if (options.insurance) {
    const active = ctx.db
      .select()
      .from(insurancePolicies)
      .where(
        and(
          isNull(insurancePolicies.archivedAt),
          isNotNull(insurancePolicies.endDate),
        ),
      )
      .all();
    for (const policy of active) {
      const deadline = cancellationDeadline({
        renewal: policy.renewal,
        endDate: policy.endDate,
        cancellationNoticeMonths: policy.cancellationNoticeMonths,
      });
      // One whose deadline has passed has nothing left to remind of; it comes back when somebody moves the end date.
      if (!deadline || deadline < today) continue;
      entries.push({
        kind: "insurance_deadlines",
        itemId: policy.id,
        instance: "",
        uid: `insurance-${uidPart(policy.id)}-cancel`,
        date: deadline,
        summary: m.cal_insurance_summary({ title: policy.title }, o),
        description: place(null, null, [
          m.cal_insurance_line({ date: policy.endDate as string }, o),
        ]),
        path: `/insurance/${policy.id}`,
        alarmable: true,
        lastModified: policy.updatedAt.getTime(),
      });
    }
  }

  if (options.appointments) {
    const lookback = ctx.now - APPOINTMENT_LOOKBACK_DAYS * DAY_MS;
    const booked = ctx.db
      .select({
        appointment: appointments,
        taskTitle: tasks.title,
        taskAssignMode: tasks.assignMode,
        currentAssignee: taskState.currentAssigneeUserId,
        assetName: assets.name,
      })
      .from(appointments)
      .leftJoin(tasks, eq(tasks.id, appointments.taskId))
      .leftJoin(taskState, eq(taskState.taskId, appointments.taskId))
      .leftJoin(assets, eq(assets.id, appointments.assetId))
      .where(
        and(
          ne(appointments.status, "cancelled"),
          or(
            and(
              eq(appointments.allDay, false),
              gte(appointments.endsAt, new Date(lookback)),
            ),
            // A day wider than needed (the day after the last one is the instant that counts): the
            // exact check below does the rest, this only keeps the history out of memory.
            and(
              eq(appointments.allDay, true),
              gte(appointments.endDate, addDays(localDateOf(tz, lookback), -1)),
            ),
          ),
        ),
      )
      .all();
    for (const r of booked) {
      const a = r.appointment;
      const when = whenOf(a);
      if (endInstant(when, tz) < lookback) continue;
      const mine =
        options.scope === "all" ||
        a.taskId === null ||
        r.taskAssignMode === "none" ||
        r.currentAssignee === options.userId;
      if (!mine) continue;
      entries.push({
        kind: "appointments",
        itemId: a.id,
        instance: "",
        uid: `appointment-${uidPart(a.id)}`,
        date: when.allDay
          ? { start: when.startDate, end: addDays(when.endDate, 1) }
          : { startsAt: when.startsAt, endsAt: when.endsAt },
        summary: a.title,
        description: place(
          r.assetName,
          null,
          r.taskTitle ? [m.cal_prep_for({ task: r.taskTitle }, o)] : [],
        ),
        ...(a.location ? { location: a.location } : {}),
        path: `/appointments/${a.id}`,
        busy: !when.allDay,
        alarmable: a.status === "planned",
        lastModified: a.updatedAt.getTime(),
      });
    }
  }

  return entries;
}

/** Active, not snoozed tasks that the scope covers and no other entry stands for, with their cached verdict. */
function readTasks(ctx: ServiceContext, options: EntryOptions, today: string) {
  const assetRoom = alias(rooms, "asset_room");
  return ctx.db
    .select({
      task: tasks,
      state: taskState,
      assetName: assets.name,
      ownRoomName: rooms.name,
      assetRoomName: assetRoom.name,
    })
    .from(tasks)
    .innerJoin(taskState, eq(taskState.taskId, tasks.id))
    .leftJoin(assets, eq(assets.id, tasks.assetId))
    .leftJoin(rooms, eq(rooms.id, tasks.roomId))
    .leftJoin(assetRoom, eq(assetRoom.id, assets.roomId))
    .where(
      and(
        isNull(tasks.archivedAt),
        options.skipTaskSources.length > 0
          ? or(
              isNull(tasks.externalSource),
              notInArray(tasks.externalSource, [...options.skipTaskSources]),
            )
          : undefined,
      ),
    )
    .all()
    .map((r) => ({ ...r, state: toStateRecord(r.state) }))
    .filter(
      (r) =>
        r.state.status !== "snoozed" &&
        !(r.task.snoozedUntil && r.task.snoozedUntil > today) &&
        (options.scope === "all" ||
          r.task.assignMode === "none" ||
          r.state.currentAssigneeUserId === options.userId),
    );
}
