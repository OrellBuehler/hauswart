import type { UserLocale } from "$lib/api/enums";
import type { Appointment } from "$lib/api/schemas/appointments";
import { diffDays, localDateOf, localTimeOf } from "$lib/dates";
import { formatDateShort, formatRelativeDays } from "$lib/format";
import { m } from "$lib/paraglide/messages";
import type { AppointmentWhen } from "./when";

/** What says when an appointment takes place: the fields of an appointment. */
export type WhenFields = Pick<
  Appointment,
  "allDay" | "startsAt" | "endsAt" | "startDate" | "endDate"
>;

/** What the next appointment of a task says about it. */
export type StartFields = Pick<
  Appointment,
  "allDay" | "startsAt" | "startDate"
>;

export type FormatOptions = {
  /** The household's time zone. */
  timeZone: string;
  /** Leaves the year out within today's year. */
  today?: string | undefined;
  locale?: UserLocale | undefined;
};

/** The `when` an appointment carries: instants for a timed one, dates for an all-day one. */
export function whenOf(a: WhenFields): AppointmentWhen {
  if (a.allDay) {
    if (a.startDate === null || a.endDate === null) {
      throw new Error("An all-day appointment without its dates.");
    }
    return { allDay: true, startDate: a.startDate, endDate: a.endDate };
  }
  if (a.startsAt === null || a.endsAt === null) {
    throw new Error("A timed appointment without its instants.");
  }
  return {
    allDay: false,
    startsAt: Date.parse(a.startsAt),
    endsAt: Date.parse(a.endsAt),
  };
}

export type Span = {
  /** The first day, in the household zone. */
  first: string;
  /** The last day it touches (an end at midnight belongs to the day before). */
  last: string;
  /** `HH:MM`; null for an all-day appointment. */
  startTime: string | null;
  endTime: string | null;
};

/** The days an appointment covers and, if it is timed, its wall-clock times, in `timeZone`. */
export function spanOf(a: WhenFields, timeZone: string): Span {
  const when = whenOf(a);
  if (when.allDay) {
    return {
      first: when.startDate,
      last: when.endDate,
      startTime: null,
      endTime: null,
    };
  }
  return {
    first: localDateOf(timeZone, when.startsAt),
    last: localDateOf(timeZone, when.endsAt - 1),
    startTime: localTimeOf(timeZone, when.startsAt),
    endTime: localTimeOf(timeZone, when.endsAt),
  };
}

/** The day an appointment (or the next appointment of a task) starts on, in `timeZone`. */
export function startDayOf(a: StartFields, timeZone: string): string {
  if (a.allDay) {
    if (a.startDate === null) {
      throw new Error("An all-day appointment without its start date.");
    }
    return a.startDate;
  }
  if (a.startsAt === null) {
    throw new Error("A timed appointment without its start.");
  }
  return localDateOf(timeZone, Date.parse(a.startsAt));
}

function capitalize(text: string, locale?: UserLocale): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** "Heute", "Morgen" and "Gestern" for the days around `today`, else the short date with its weekday. */
export function formatDayLabel(
  date: string,
  options: { today: string; locale?: UserLocale | undefined },
): string {
  const days = diffDays(date, options.today);
  if (Math.abs(days) <= 1) {
    return capitalize(formatRelativeDays(days, options.locale), options.locale);
  }
  return formatDateShort(date, options);
}

/** The heading of a day in a list: "Heute · Sa., 10. Okt." around today, else "Mi., 14. Okt.". */
export function formatDayHeading(
  date: string,
  options: { today: string; locale?: UserLocale | undefined },
): string {
  const short = formatDateShort(date, options);
  return Math.abs(diffDays(date, options.today)) <= 1
    ? `${formatDayLabel(date, options)} · ${short}`
    : short;
}

/**
 * When an appointment takes place as one line, in the household zone:
 * "Sa., 10. Okt. · 09:00–10:00", across midnight "Sa., 10. Okt., 23:00 – So., 11. Okt., 01:00",
 * all-day "Sa., 10. Okt. – Mo., 12. Okt. · ganztägig".
 */
export function formatWhen(a: WhenFields, options: FormatOptions): string {
  const { first, last, startTime, endTime } = spanOf(a, options.timeZone);
  const day = (date: string) => formatDateShort(date, options);
  if (startTime === null || endTime === null) {
    const days = first === last ? day(first) : `${day(first)} – ${day(last)}`;
    return `${days} · ${m.appointment_all_day({}, { locale: options.locale })}`;
  }
  if (first === last) return `${day(first)} · ${startTime}–${endTime}`;
  return `${day(first)}, ${startTime} – ${day(last)}, ${endTime}`;
}

/** The time of an appointment for a row below a day heading, in two lines. */
export type TimeColumn = { primary: string; secondary: string | null };

/**
 * What a row below the heading of `day` says about the time: "09:00" over "–10:00", "ganztägig".
 * An appointment of several days says on its first day when it ends ("bis Mo., 12. Okt."); on a later
 * day, where an upcoming list shows what is still going on, it reads "Läuft" and "bis 01:00".
 * `day` is the first day of the appointment unless given.
 */
export function timeColumn(
  a: WhenFields,
  options: FormatOptions & { day?: string },
): TimeColumn {
  const { first, last, startTime, endTime } = spanOf(a, options.timeZone);
  const locale = { locale: options.locale };
  const day = options.day ?? first;
  const untilDay = (date: string) =>
    m.appointment_until(
      { when: formatDateShort(date, { ...options, weekday: false }) },
      locale,
    );
  const untilTime = (when: string) => m.appointment_until({ when }, locale);
  if (startTime === null || endTime === null) {
    return {
      primary: m.appointment_all_day({}, locale),
      secondary: first === last ? null : untilDay(last),
    };
  }
  if (day !== first) {
    return {
      primary: m.appointment_ongoing({}, locale),
      secondary: last === day ? untilTime(endTime) : untilDay(last),
    };
  }
  return {
    primary: startTime,
    secondary: first === last ? `–${endTime}` : untilDay(last),
  };
}

/**
 * The start only, short enough for a badge: "Heute, 09:00", "Mi., 14. Okt., 09:00", "Morgen".
 * The day is worded relative to `today` around it.
 */
export function formatStart(
  a: StartFields,
  options: FormatOptions & { today: string },
): string {
  const day = formatDayLabel(startDayOf(a, options.timeZone), options);
  if (a.allDay || a.startsAt === null) return day;
  return `${day}, ${localTimeOf(options.timeZone, Date.parse(a.startsAt))}`;
}
