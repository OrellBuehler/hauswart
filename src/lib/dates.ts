const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_MS = 86_400_000;

export type ParsedDate = { year: number; month: number; day: number };

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month: ${month}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function parseDate(value: string): ParsedDate {
  if (!isValidDate(value)) {
    throw new RangeError(`Not a valid YYYY-MM-DD date: "${value}"`);
  }
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

export function formatDate(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError(`Year out of range: ${year}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid day ${day} for ${year}-${month}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): ParsedDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Days since 1970-01-01 (negative before). */
export function dayNumber(date: string): number {
  const { year, month, day } = parseDate(date);
  return daysFromCivil(year, month, day);
}

export function fromDayNumber(days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Day number must be an integer, got ${days}`);
  }
  const { year, month, day } = civilFromDays(days);
  return formatDate(year, month, day);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseDate(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function addYears(date: string, years: number): string {
  return addMonths(date, years * 12);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function weekday(date: string): number {
  const dn = dayNumber(date);
  return ((((dn + 3) % 7) + 7) % 7) + 1;
}

export function isoWeekStart(date: string): string {
  return addDays(date, -(weekday(date) - 1));
}

export function isoWeekEnd(date: string): string {
  return addDays(date, 7 - weekday(date));
}

export function isoWeek(date: string): { year: number; week: number } {
  const thursday = addDays(date, 4 - weekday(date));
  const { year } = parseDate(thursday);
  const dayOfYear =
    dayNumber(thursday) - dayNumber(`${String(year).padStart(4, "0")}-01-01`);
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

export function monthStart(date: string): string {
  const { year, month } = parseDate(date);
  return formatDate(year, month, 1);
}

export function monthEnd(date: string): string {
  const { year, month } = parseDate(date);
  return formatDate(year, month, daysInMonth(year, month));
}

export function quarterStart(date: string): string {
  const { year, month } = parseDate(date);
  return formatDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
}

export function quarterEnd(date: string): string {
  return monthEnd(addMonths(quarterStart(date), 2));
}

export function yearStart(date: string): string {
  return formatDate(parseDate(date).year, 1, 1);
}

export function yearEnd(date: string): string {
  return formatDate(parseDate(date).year, 12, 31);
}

/** a - b in whole days. */
export function diffDays(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * The nth weekday (ISO 1-7) of a month. nth 1 = first, -1 = last.
 * Returns null when the month has no such occurrence (e.g. a fifth Monday).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  wd: number,
  nth: number,
): string | null {
  if (!Number.isInteger(nth) || nth === 0) {
    throw new RangeError(`nth must be a non-zero integer, got ${nth}`);
  }
  const dim = daysInMonth(year, month);
  let day: number;
  if (nth > 0) {
    const first = weekday(formatDate(year, month, 1));
    day = 1 + ((wd - first + 7) % 7) + 7 * (nth - 1);
  } else {
    const last = weekday(formatDate(year, month, dim));
    day = dim - ((last - wd + 7) % 7) - 7 * (-nth - 1);
  }
  return day >= 1 && day <= dim ? formatDate(year, month, day) : null;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(timeZone: string, instantMs: number): ZonedParts {
  if (!Number.isFinite(instantMs)) {
    throw new RangeError(`Invalid instant: ${instantMs}`);
  }
  const out: ZonedParts = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  };
  for (const part of formatterFor(timeZone).formatToParts(instantMs)) {
    if (part.type in out) {
      out[part.type as keyof ZonedParts] = Number(part.value);
    }
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** The calendar date in `timeZone` at the given instant. */
export function localDateOf(timeZone: string, instantMs: number): string {
  const p = zonedParts(timeZone, instantMs);
  return formatDate(p.year, p.month, p.day);
}

export function todayIn(timeZone: string, nowMs: number): string {
  return localDateOf(timeZone, nowMs);
}

/** UTC offset of `timeZone` at the instant, in milliseconds (positive east of UTC). */
export function utcOffsetMs(timeZone: string, instantMs: number): number {
  const t = Math.floor(instantMs / 1000) * 1000;
  const p = zonedParts(timeZone, t);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
}

/**
 * Instant (ms) of the wall-clock time `date` `HH:MM` in `timeZone`.
 * A time skipped by a spring-forward gap resolves to the same offset as before the gap
 * (02:30 becomes 03:30); an ambiguous time in a fall-back overlap resolves to the first one.
 */
export function zonedTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): number {
  const { year, month, day } = parseDate(date);
  const tm = TIME_RE.exec(time);
  if (!tm) throw new RangeError(`Not a valid HH:MM time: "${time}"`);
  const guess = Date.UTC(year, month - 1, day, Number(tm[1]), Number(tm[2]));
  const before = utcOffsetMs(timeZone, guess - DAY_MS);
  const after = utcOffsetMs(timeZone, guess + DAY_MS);
  const candidates = [...new Set([before, after])]
    .map((offset) => ({ offset, instant: guess - offset }))
    .filter((c) => utcOffsetMs(timeZone, c.instant) === c.offset)
    .map((c) => c.instant);
  if (candidates.length === 0) return guess - before;
  return Math.min(...candidates);
}
