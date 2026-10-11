import { APPOINTMENT_STATUSES, type AppointmentStatus } from "$lib/api/enums";
import type { Appointment } from "$lib/api/schemas/appointments";
import { addDays } from "$lib/dates";
import { spanOf, whenOf } from "./format";
import { endInstant, startInstant } from "./when";

export const APPOINTMENT_VIEWS = ["upcoming", "past"] as const;
export type AppointmentView = (typeof APPOINTMENT_VIEWS)[number];

/** How far back the upcoming view looks for appointments that are over but were never closed. */
export const OPEN_LOOKBACK_DAYS = 30;
/** How far back the past view reaches before "older" is asked for. */
export const PAST_WINDOW_DAYS = 365;

export type AppointmentFilters = {
  view: AppointmentView;
  statuses: AppointmentStatus[];
};

/** Planned ones are what the upcoming view is about; the past view shows what became of them too. */
export function defaultStatuses(view: AppointmentView): AppointmentStatus[] {
  return view === "upcoming" ? ["planned"] : [...APPOINTMENT_STATUSES];
}

export function parseView(value: string | null): AppointmentView {
  return APPOINTMENT_VIEWS.find((view) => view === value) ?? "upcoming";
}

/**
 * `?status=planned,done` as a list in the order of the statuses; anything else, an empty list included,
 * is the default of the view.
 */
export function parseStatuses(
  value: string | null,
  view: AppointmentView,
): AppointmentStatus[] {
  const given = new Set((value ?? "").split(","));
  const known = APPOINTMENT_STATUSES.filter((status) => given.has(status));
  return known.length > 0 ? known : defaultStatuses(view);
}

export function parseFilters(params: URLSearchParams): AppointmentFilters {
  const view = parseView(params.get("view"));
  return { view, statuses: parseStatuses(params.get("status"), view) };
}

const sameStatuses = (
  a: readonly AppointmentStatus[],
  b: readonly AppointmentStatus[],
) => a.length === b.length && a.every((status) => b.includes(status));

/** The filters as a query string without what is the default, e.g. `?view=past&status=done`. */
export function filterQuery(filters: AppointmentFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== "upcoming") params.set("view", filters.view);
  if (!sameStatuses(filters.statuses, defaultStatuses(filters.view))) {
    params.set("status", filters.statuses.join(","));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function isDefaultFilter(filters: AppointmentFilters): boolean {
  return sameStatuses(filters.statuses, defaultStatuses(filters.view));
}

/** Switches a status on or off; the last one cannot be switched off. */
export function toggleStatus(
  statuses: readonly AppointmentStatus[],
  status: AppointmentStatus,
): AppointmentStatus[] {
  if (!statuses.includes(status)) {
    return APPOINTMENT_STATUSES.filter(
      (s) => s === status || statuses.includes(s),
    );
  }
  return statuses.length === 1
    ? [...statuses]
    : statuses.filter((s) => s !== status);
}

/** The `GET /appointments` range of a view: the days from `from` to `to`, both included. */
export function viewRange(
  view: AppointmentView,
  today: string,
): { from: string; to?: string } {
  return view === "upcoming"
    ? { from: addDays(today, -OPEN_LOOKBACK_DAYS) }
    : {
        from: addDays(today, -PAST_WINDOW_DAYS),
        to: addDays(today, -1),
      };
}

/** The range "older" asks for: everything before the past view's window. */
export function olderRange(today: string): { to: string } {
  return { to: addDays(today, -PAST_WINDOW_DAYS - 1) };
}

/**
 * `more` appended to `base` without what `base` (or `more` itself) already has. The ranges of the two
 * lists meet at a day, and an appointment that spans it is in both.
 */
export function appendById(
  base: readonly Appointment[],
  more: readonly Appointment[],
): Appointment[] {
  const seen = new Set(base.map((a) => a.id));
  const merged = [...base];
  for (const a of more) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
  }
  return merged;
}

/** Whether the last day of the appointment, in the household zone, is before `today`. */
export function isOver(
  a: Appointment,
  today: string,
  timeZone: string,
): boolean {
  return spanOf(a, timeZone).last < today;
}

/** Over and neither done nor cancelled: whoever planned it still has to close it. */
export function needsClosing(
  a: Appointment,
  today: string,
  timeZone: string,
): boolean {
  return a.status === "planned" && isOver(a, today, timeZone);
}

/** Soonest first: by the first instant, longer first, then title and id, as the server orders them. */
export function compareByStart(
  a: Appointment,
  b: Appointment,
  timeZone: string,
): number {
  const [wa, wb] = [whenOf(a), whenOf(b)];
  return (
    startInstant(wa, timeZone) - startInstant(wb, timeZone) ||
    endInstant(wb, timeZone) - endInstant(wa, timeZone) ||
    a.title.localeCompare(b.title, "de") ||
    a.id.localeCompare(b.id)
  );
}

export type DayGroup = { date: string; items: Appointment[] };

/**
 * Appointments grouped by the day they start on in the household zone, soonest first (or the other
 * way round with `newestFirst`). With `clampTo`, one that started before that day and is still going
 * belongs to that day: an upcoming list shows what takes place today under "today".
 */
export function groupByDay(
  items: readonly Appointment[],
  options: { timeZone: string; clampTo?: string; newestFirst?: boolean },
): DayGroup[] {
  const sorted = [...items].sort((a, b) =>
    compareByStart(a, b, options.timeZone),
  );
  if (options.newestFirst) sorted.reverse();
  const groups = new Map<string, Appointment[]>();
  for (const item of sorted) {
    let date = spanOf(item, options.timeZone).first;
    if (options.clampTo !== undefined && date < options.clampTo) {
      date = options.clampTo;
    }
    const group = groups.get(date);
    if (group) group.push(item);
    else groups.set(date, [item]);
  }
  const days = [...groups.keys()].sort();
  if (options.newestFirst) days.reverse();
  return days.map((date) => ({ date, items: groups.get(date) ?? [] }));
}

export type Sections = {
  /** Planned and over: still to be closed. Oldest first. */
  open: Appointment[];
  days: DayGroup[];
};

/**
 * What the list shows for a view and the statuses switched on. Upcoming: what is not over yet by day,
 * and the planned ones that are over as "open"; done or cancelled ones that are over belong to the
 * past view. Past: everything that is over, newest first.
 */
export function sectionsFor(
  appointments: readonly Appointment[],
  filters: AppointmentFilters,
  context: { today: string; timeZone: string },
): Sections {
  const wanted = appointments.filter((a) =>
    filters.statuses.includes(a.status),
  );
  const over = (a: Appointment) => isOver(a, context.today, context.timeZone);
  if (filters.view === "past") {
    return {
      open: [],
      days: groupByDay(wanted.filter(over), {
        timeZone: context.timeZone,
        newestFirst: true,
      }),
    };
  }
  return {
    open: wanted
      .filter((a) => a.status === "planned" && over(a))
      .sort((a, b) => compareByStart(a, b, context.timeZone)),
    days: groupByDay(
      wanted.filter((a) => !over(a)),
      { timeZone: context.timeZone, clampTo: context.today },
    ),
  };
}

export function countSections(sections: Sections): number {
  return (
    sections.open.length +
    sections.days.reduce((sum, group) => sum + group.items.length, 0)
  );
}
