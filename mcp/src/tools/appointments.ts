import { z } from "zod";
import { APPOINTMENT_STATUSES } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Appointment } from "../../../src/lib/api/schemas/appointments";
import {
  addDays,
  diffDays,
  localDateOf,
  localTimeOf,
  zonedTimeToInstant,
} from "../../../src/lib/dates";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { completionRow, moreHint, plural, taskRow } from "../format";
import { defineTool } from "../tool";
import { resolveContact, resolveTask } from "./resolve";
import { completedAt } from "./tasks";

const id = z.string().min(1).max(64);
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Expected a time as HH:MM, 24 hours.",
});
const appointmentId = id.describe("Appointment id, from list_appointments");

/** "2026-11-03 14:30-15:30", "2026-11-03, all day", "2026-11-03 to 2026-11-05, all day". */
export function describeAppointmentTime(a: Appointment, zone: string): string {
  if (a.allDay) {
    return a.endDate === a.startDate
      ? `${a.startDate}, all day`
      : `${a.startDate} to ${a.endDate}, all day`;
  }
  const start = Date.parse(a.startsAt!);
  const end = Date.parse(a.endsAt!);
  const day = localDateOf(zone, start);
  const endDay = localDateOf(zone, end);
  return `${day} ${localTimeOf(zone, start)}-${
    endDay === day ? "" : `${endDay} `
  }${localTimeOf(zone, end)}`;
}

const appointmentRow = (a: Appointment, zone: string) => ({
  id: a.id,
  title: a.title,
  when: describeAppointmentTime(a, zone),
  location: a.location,
  status: a.status === "planned" ? null : a.status,
  task: a.taskTitle,
  taskId: a.taskId,
  asset: a.assetName,
  contact: a.contactName,
});

const instant = (day: string, at: string, zone: string) =>
  new Date(zonedTimeToInstant(day, at, zone)).toISOString();

const refs = {
  task: z
    .string()
    .min(1)
    .max(160)
    .describe("Task id or title: the task this appointment is for"),
  asset: z.string().min(1).max(120).describe("Asset id, name or plate"),
  contact: z
    .string()
    .min(1)
    .max(120)
    .describe("Contact id, name or company (who comes, e.g. the technician)"),
};

async function resolveRefs(
  ctx: ToolContext,
  args: { task?: string; asset?: string; contact?: string },
) {
  const [task, asset, contact] = await Promise.all([
    args.task ? resolveTask(ctx, args.task) : undefined,
    args.asset ? ctx.resolveAsset(args.asset) : undefined,
    args.contact ? resolveContact(ctx, args.contact) : undefined,
  ]);
  return { task, asset, contact };
}

export const listAppointments = defineTool({
  name: "list_appointments",
  title: "List appointments",
  description:
    "The household's appointments (service visits, inspections, deliveries) soonest first, with when (in the household time zone), place, status and the task, device and contact they belong to. from (default today) and to are days, both included: a timed appointment counts on every day it touches. status: planned (default), done, cancelled or all. Filter by task (id or title), asset and contact. Book one with create_appointment, change it with update_appointment, finish it with complete_appointment.",
  mode: "read",
  input: {
    from: date.optional().describe("First day, default today."),
    to: date.optional().describe("Last day, default: no end."),
    status: z.enum([...APPOINTMENT_STATUSES, "all"]).default("planned"),
    task: refs.task.optional(),
    asset: refs.asset.optional(),
    contact: refs.contact.optional(),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const { task, asset, contact } = await resolveRefs(ctx, args);
    const from = args.from ?? ctx.today();
    const page = await ctx.api.call(endpoints.appointmentsList, {
      query: {
        from,
        to: args.to,
        status: args.status === "all" ? undefined : args.status,
        taskId: task?.id,
        assetId: asset?.id,
        contactId: contact?.id,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    const zone = ctx.household.timezone;
    return {
      summary: `${plural(page.items.length, "appointment")} from ${from}${args.to ? ` to ${args.to}` : ""}.${moreHint(page.nextCursor)}`,
      data: {
        appointments: page.items.map((a) => appointmentRow(a, zone)),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const createAppointment = defineTool({
  name: "create_appointment",
  title: "Book an appointment",
  description:
    "Adds an appointment. date is the day (YYYY-MM-DD, household time zone); with startTime (HH:MM, 24 hours) it is a timed appointment that ends at endTime (default one hour later; an end on another day needs endDate), without startTime it is an all-day appointment that can run to endDate (at most 14 days in all). task (id or title) links it to a recurring task, for the occurrence the task shows now: completing the appointment with complete_appointment then completes that occurrence, and the task shows the appointment as its next one. asset and contact are optional (the asset defaults to the task's). location is a place, notes plain text. Check list_appointments first to avoid booking twice.",
  mode: "create",
  input: {
    title: z.string().trim().min(1).max(200),
    date: date.describe("The day, or the first day of an all-day appointment"),
    startTime: time.optional(),
    endTime: time.optional(),
    endDate: date
      .optional()
      .describe("Last day; default: the same day as date"),
    location: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(5000).optional(),
    task: refs.task.optional(),
    asset: refs.asset.optional(),
    contact: refs.contact.optional(),
  },
  async handler(args, ctx) {
    const zone = ctx.household.timezone;
    if (args.startTime === undefined && args.endTime !== undefined) {
      throw new ToolError(
        "invalid_request",
        "endTime needs a startTime; leave both out for an all-day appointment.",
      );
    }
    const { task, asset, contact } = await resolveRefs(ctx, args);
    const when =
      args.startTime === undefined
        ? {
            allDay: true,
            startDate: args.date,
            endDate: args.endDate ?? args.date,
          }
        : {
            startsAt: instant(args.date, args.startTime, zone),
            ...(args.endTime === undefined && args.endDate === undefined
              ? {}
              : {
                  endsAt: instant(
                    args.endDate ?? args.date,
                    args.endTime ?? args.startTime,
                    zone,
                  ),
                }),
          };
    const created = await ctx.api.call(endpoints.appointmentsCreate, {
      body: {
        title: args.title,
        ...when,
        location: args.location,
        notes: args.notes,
        taskId: task?.id,
        assetId: asset?.id,
        contactId: contact?.id,
      },
    });
    return {
      summary: `Booked "${created.title}": ${describeAppointmentTime(created, zone)}.`,
      data: appointmentRow(created, zone),
    };
  },
});

/** The time fields of an update: the appointment keeps its length unless an end is given. */
function rescheduled(
  args: {
    date?: string;
    startTime?: string;
    endTime?: string;
    endDate?: string;
    allDay?: boolean;
  },
  current: Appointment,
  zone: string,
) {
  const allDay =
    args.allDay ?? (args.startTime !== undefined ? false : current.allDay);
  const hasEnd = args.endTime !== undefined || args.endDate !== undefined;

  if (allDay) {
    if (args.startTime !== undefined || args.endTime !== undefined) {
      throw new ToolError(
        "invalid_request",
        "An all-day appointment has no times: leave out startTime and endTime, or set allDay to false.",
      );
    }
    const startDate =
      args.date ??
      (current.allDay
        ? current.startDate!
        : localDateOf(zone, Date.parse(current.startsAt!)));
    const length = current.allDay
      ? diffDays(current.endDate!, current.startDate!)
      : 0;
    const endDate = args.endDate ?? addDays(startDate, length);
    return current.allDay
      ? { startDate, endDate }
      : { allDay: true, startDate, endDate };
  }

  if (current.allDay) {
    if (args.startTime === undefined) {
      throw new ToolError(
        "invalid_request",
        "startTime is needed to make an all-day appointment a timed one.",
      );
    }
    const day = args.date ?? current.startDate!;
    return {
      allDay: false,
      startsAt: instant(day, args.startTime, zone),
      ...(hasEnd
        ? {
            endsAt: instant(
              args.endDate ?? day,
              args.endTime ?? args.startTime,
              zone,
            ),
          }
        : {}),
    };
  }

  const startsAt = Date.parse(current.startsAt!);
  const endsAt = Date.parse(current.endsAt!);
  const day = args.date ?? localDateOf(zone, startsAt);
  const newStart = zonedTimeToInstant(
    day,
    args.startTime ?? localTimeOf(zone, startsAt),
    zone,
  );
  const newEnd = hasEnd
    ? zonedTimeToInstant(
        args.endDate ?? (args.date ? day : localDateOf(zone, endsAt)),
        args.endTime ?? localTimeOf(zone, endsAt),
        zone,
      )
    : newStart + (endsAt - startsAt);
  return {
    startsAt: new Date(newStart).toISOString(),
    endsAt: new Date(newEnd).toISOString(),
  };
}

export const updateAppointment = defineTool({
  name: "update_appointment",
  title: "Change an appointment",
  description:
    "Changes an appointment; only what you pass changes. To move it pass date and/or startTime: the appointment keeps its length unless you also pass endTime/endDate. startTime on an all-day appointment makes it a timed one, allDay: true makes a timed one all-day. status: cancelled calls it off (it leaves the calendar feeds), planned reopens it, done records that it took place WITHOUT completing its task (use complete_appointment for that). task, asset and contact take an id or name, null removes the link (a new task is linked for the occurrence it shows now). location and notes: an empty string clears them.",
  mode: "update",
  input: {
    id: appointmentId,
    title: z.string().trim().min(1).max(200).optional(),
    date: date.optional().describe("Move to this day"),
    startTime: time.optional(),
    endTime: time.optional(),
    endDate: date.optional(),
    allDay: z.boolean().optional(),
    location: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(5000).optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    task: refs.task.nullable().optional(),
    asset: refs.asset.nullable().optional(),
    contact: refs.contact.nullable().optional(),
  },
  async handler({ id: appointment, ...args }, ctx) {
    const zone = ctx.household.timezone;
    const touchesTime = [
      args.date,
      args.startTime,
      args.endTime,
      args.endDate,
      args.allDay,
    ].some((v) => v !== undefined);
    const [current, task, asset, contact] = await Promise.all([
      touchesTime
        ? ctx.api.call(endpoints.appointmentsGet, {
            params: { id: appointment },
          })
        : undefined,
      args.task ? resolveTask(ctx, args.task) : undefined,
      args.asset ? ctx.resolveAsset(args.asset) : undefined,
      args.contact ? resolveContact(ctx, args.contact) : undefined,
    ]);
    const body = {
      title: args.title,
      ...(current ? rescheduled(args, current, zone) : {}),
      location: args.location,
      notes: args.notes,
      status: args.status,
      taskId: args.task === null ? null : task?.id,
      assetId: args.asset === null ? null : asset?.id,
      contactId: args.contact === null ? null : contact?.id,
    };
    if (Object.values(body).every((v) => v === undefined)) {
      throw new ToolError(
        "invalid_request",
        "Pass at least one field to change.",
      );
    }
    const updated = await ctx.api.call(endpoints.appointmentsUpdate, {
      params: { id: appointment },
      body,
    });
    return {
      summary: `Updated "${updated.title}": ${describeAppointmentTime(updated, zone)}${updated.status === "planned" ? "" : ` (${updated.status})`}.`,
      data: appointmentRow(updated, zone),
    };
  },
});

export const completeAppointment = defineTool({
  name: "complete_appointment",
  title: "Mark an appointment done",
  description:
    "Records that an appointment took place: it becomes done and, when it belongs to a task, the occurrence it was booked for is completed too (as the token's user, with the optional note; completedDate backdates it, default today) and the next due date follows. If that occurrence was settled meanwhile (completed or skipped by hand), the task is left as it is. Repeating it changes nothing. A cancelled appointment cannot be completed (reopen it with update_appointment first). Undoing the task's completion later with undo_completion does not reopen the appointment.",
  mode: "update",
  input: {
    id: appointmentId,
    note: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe("Optional remark stored with the task's completion."),
    completedDate: date
      .optional()
      .describe("When it was done, YYYY-MM-DD; default today."),
  },
  async handler({ id: appointment, note, completedDate }, ctx) {
    const done = await ctx.api.call(endpoints.appointmentsComplete, {
      params: { id: appointment },
      body: { note, completedAt: completedAt(ctx, completedDate) },
    });
    const zone = ctx.household.timezone;
    const a = done.appointment;
    const taskPart = done.completion
      ? ` and completed the task "${done.task?.title}"`
      : done.task
        ? ` (the task "${done.task.title}" was left as it is)`
        : "";
    return {
      summary: done.replayed
        ? `"${a.title}" was already done.`
        : `Marked "${a.title}" done${taskPart}.`,
      data: {
        appointment: appointmentRow(a, zone),
        completion: done.completion ? completionRow(done.completion) : null,
        task: done.task ? taskRow(done.task, await ctx.users()) : null,
        replayed: done.replayed ? true : null,
      },
    };
  },
});

export const appointmentTools = [
  listAppointments,
  createAppointment,
  updateAppointment,
  completeAppointment,
];
