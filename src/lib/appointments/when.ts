import { addDays, diffDays, localDateOf, zonedTimeToInstant } from "../dates";

/** The longest an appointment can last, in days (an all-day one counts its first and last day). */
export const MAX_APPOINTMENT_DAYS = 14;
/** The length of a timed appointment created without an end. */
export const DEFAULT_APPOINTMENT_MINUTES = 60;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * The longest a timed appointment can be, in real time: 14 days plus the hour that 14 calendar days
 * can have more when the clocks go back (the limit is about days, and this function has no time
 * zone to count them in). One that goes forward makes them an hour shorter, which is within it.
 */
export const MAX_TIMED_SPAN_MS = MAX_APPOINTMENT_DAYS * DAY_MS + HOUR_MS;

/**
 * When an appointment takes place. A timed one has instants (ms since epoch, the end after the
 * start); an all-day one has calendar dates in the household time zone, the last day included.
 */
export type AppointmentWhen =
  | { allDay: false; startsAt: number; endsAt: number }
  | { allDay: true; startDate: string; endDate: string };

/** What is wrong with a `when`: the request field to report it on and a message. */
export interface WhenProblem {
  field: "endsAt" | "endDate";
  message: string;
}

/** The end an appointment gets when only its start is given. */
export function defaultEnd(startsAt: number): number {
  return startsAt + DEFAULT_APPOINTMENT_MINUTES * MINUTE_MS;
}

/**
 * Null when the span is fine; the end must come after the start and the whole must not exceed 14 days
 * (a timed one: 14 calendar days in any zone, so up to an hour more in real time, see `MAX_TIMED_SPAN_MS`).
 */
export function whenProblem(when: AppointmentWhen): WhenProblem | null {
  if (when.allDay) {
    if (when.endDate < when.startDate) {
      return {
        field: "endDate",
        message: "The end date must not be before the start date.",
      };
    }
    if (diffDays(when.endDate, when.startDate) + 1 > MAX_APPOINTMENT_DAYS) {
      return {
        field: "endDate",
        message: `An appointment lasts at most ${MAX_APPOINTMENT_DAYS} days.`,
      };
    }
    return null;
  }
  if (when.endsAt <= when.startsAt) {
    return { field: "endsAt", message: "The end must be after the start." };
  }
  if (when.endsAt - when.startsAt > MAX_TIMED_SPAN_MS) {
    return {
      field: "endsAt",
      message: `An appointment lasts at most ${MAX_APPOINTMENT_DAYS} days.`,
    };
  }
  return null;
}

/** The first instant of the appointment: its start, or midnight of its first day in `timeZone`. */
export function startInstant(when: AppointmentWhen, timeZone: string): number {
  return when.allDay
    ? zonedTimeToInstant(when.startDate, "00:00", timeZone)
    : when.startsAt;
}

/** The first instant after the appointment: its end, or midnight after its last day in `timeZone`. */
export function endInstant(when: AppointmentWhen, timeZone: string): number {
  return when.allDay
    ? zonedTimeToInstant(addDays(when.endDate, 1), "00:00", timeZone)
    : when.endsAt;
}

/** The last day the appointment touches in `timeZone`; a timed one that ends at midnight belongs to the day before. */
export function lastDay(when: AppointmentWhen, timeZone: string): string {
  return when.allDay ? when.endDate : localDateOf(timeZone, when.endsAt - 1);
}
