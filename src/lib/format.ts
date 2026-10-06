import type { UserLocale } from "$lib/api/enums";
import { diffDays, parseDate } from "$lib/dates";
import { getLocale } from "$lib/paraglide/runtime";

const INTL_LOCALES = { de: "de-CH", en: "en-GB" } as const;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function intlLocale(locale?: UserLocale): string {
  return INTL_LOCALES[locale ?? getLocale()];
}

/** A calendar date (`YYYY-MM-DD`) as a UTC instant, so that no time zone can shift the day. */
function calendarInstant(date: string): number {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

/**
 * A date in the user's language, e.g. "06.10.2026" or "06/10/2026". A bare
 * `YYYY-MM-DD` is a calendar date and never shifts with the time zone; a full
 * timestamp is shown in the browser's zone.
 */
export function formatDate(iso: string, locale?: UserLocale): string {
  if (CALENDAR_DATE.test(iso)) {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(calendarInstant(iso));
  }
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
  }).format(new Date(iso));
}

/**
 * A calendar date with its weekday, e.g. "Sa., 10. Okt." The year is added
 * when it differs from `today`'s year (or when there is no `today`).
 */
export function formatDateShort(
  date: string,
  options: { today?: string; locale?: UserLocale } = {},
): string {
  const sameYear =
    options.today !== undefined &&
    parseDate(date).year === parseDate(options.today).year;
  return new Intl.DateTimeFormat(intlLocale(options.locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(calendarInstant(date));
}

/** An instant as date and time in `timeZone` (the household's zone). */
export function formatDateTime(
  iso: string,
  options: { timeZone?: string; locale?: UserLocale } = {},
): string {
  return new Intl.DateTimeFormat(intlLocale(options.locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date(iso));
}

/** Whole days from `today` to `date`: positive in the future. */
export function daysUntil(date: string, today: string): number {
  return diffDays(date, today);
}

/** "today", "tomorrow", "in 3 days", "2 weeks ago", from a day difference. */
export function formatRelativeDays(days: number, locale?: UserLocale): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
  });
  const abs = Math.abs(days);
  if (abs < 14) return rtf.format(days, "day");
  if (abs < 60) return rtf.format(Math.round(days / 7), "week");
  if (abs < 730) return rtf.format(Math.round(days / 30.4375), "month");
  return rtf.format(Math.round(days / 365.25), "year");
}

/** "5 minutes ago", "yesterday", from an instant and the current time. */
export function formatRelativeInstant(
  iso: string,
  now: number = Date.now(),
  locale?: UserLocale,
): string {
  const diffMs = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
  });
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return rtf.format(0, "second");
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return formatRelativeDays(Math.round(diffMs / day), locale);
}

export function formatNumber(value: number, locale?: UserLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 2,
  }).format(value);
}

/** Basis points as a percentage, e.g. 5000 -> "50" and 3333 -> "33.33". */
export function formatPercent(basisPoints: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    maximumFractionDigits: 2,
  }).format(basisPoints / 100);
}

/** Weekday name for an ISO weekday (1 = Monday ... 7 = Sunday). */
export function weekdayName(
  isoWeekday: number,
  style: "long" | "short" | "narrow" = "long",
  locale?: UserLocale,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: style,
    timeZone: "UTC",
  }).format(Date.UTC(2024, 0, isoWeekday));
}

/** Month name for a month number 1-12. */
export function monthName(
  month: number,
  style: "long" | "short" = "long",
  locale?: UserLocale,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: style,
    timeZone: "UTC",
  }).format(Date.UTC(2024, month - 1, 1));
}

/** "Monday, Wednesday and Friday". */
export function formatList(items: string[], locale?: UserLocale): string {
  return new Intl.ListFormat(intlLocale(locale), {
    style: "long",
    type: "conjunction",
  }).format(items);
}

/** A day of the month as an ordinal: "15." in German, "15th" in English. */
export function formatOrdinalDay(day: number, locale?: UserLocale): string {
  const resolved = locale ?? getLocale();
  if (resolved === "de") return `${day}.`;
  const rule = new Intl.PluralRules("en-GB", { type: "ordinal" }).select(day);
  const suffix =
    rule === "one"
      ? "st"
      : rule === "two"
        ? "nd"
        : rule === "few"
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}
