import { createHash } from "node:crypto";

/**
 * RFC 5545 iCalendar feed builder (pure: no clock except an optional DTSTAMP fallback, no I/O).
 *
 * All events are all-day events (`DTSTART;VALUE=DATE`); `DTEND` is exclusive. Invalid input
 * (bad dates, empty uid/summary, end before start, ...) throws `IcsError` — callers feed this
 * from validated database rows, so a throw is a bug, not user input.
 *
 * Alarm approach (VALARM): all-day events have no clock time, so clients resolve a relative
 * trigger from local midnight of the event's first day.
 * - `{ daysBefore: n }` becomes `TRIGGER:-P{n}D` (midnight, n days before the event day).
 * - `{ time: 'HH:MM', tz, daysBefore? }` means "at HH:MM wall-clock time in `tz`, `daysBefore`
 *   days before the event day" (default 0 = the event day itself). It is emitted as a relative
 *   trigger from midnight, e.g. 18:00 the day before is `-PT6H`, 08:00 on the day is `PT8H`.
 *   The duration is computed on the real instants in `tz`, so a DST change between the alarm
 *   and midnight of the event day is accounted for (alarm Saturday 18:00 for an event on the
 *   Monday after the spring-forward Sunday is `-PT29H`, not `-PT30H`).
 * We deliberately avoid an absolute `TRIGGER;VALUE=DATE-TIME` (UTC) because it breaks when the
 * event is edited elsewhere and is ignored by some clients for all-day events; relative
 * triggers are the form every client handles. The result is only exact when the viewer's time
 * zone is `tz` (midnight of an all-day event is resolved by the client in its own zone).
 */

export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsError";
  }
}

export type IcsAlarm =
  { time: string; tz: string; daysBefore?: number } | { daysBefore: number };

export interface IcsEvent {
  uid: string;
  /** `YYYY-MM-DD` for a single all-day event, or a span with an exclusive `end`. */
  date: string | { start: string; end: string };
  summary: string;
  description?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE";
  sequence?: number;
  alarm?: IcsAlarm;
  categories?: string[];
  /** Epoch milliseconds; becomes LAST-MODIFIED and, when present, DTSTAMP. */
  lastModified?: number;
}

export interface BuildIcsOptions {
  calendarName: string;
  events: IcsEvent[];
  /** Suggested client refresh interval. Default 12. */
  refreshIntervalHours?: number;
  prodId: string;
  /**
   * Epoch milliseconds used for DTSTAMP of events without `lastModified`. Pass a stable value
   * (for example the newest `lastModified`) to keep the output, and so the ETag, stable.
   * Defaults to the current time.
   */
  now?: number;
}

const CRLF = "\r\n";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;
const MAX_DAYS_BEFORE = 365;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parseDate(value: string, label: string): Ymd {
  const match = DATE_RE.exec(value);
  if (!match)
    throw new IcsError(`${label}: expected YYYY-MM-DD, got "${value}"`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new IcsError(`${label}: not a calendar date: "${value}"`);
  }
  return { y, m, d };
}

function dayNumber({ y, m, d }: Ymd): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function ymdFromDayNumber(day: number): Ymd {
  const date = new Date(day * DAY_MS);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function formatDate({ y, m, d }: Ymd): string {
  return `${pad(y, 4)}${pad(m)}${pad(d)}`;
}

function formatUtc(ms: number): string {
  if (!Number.isFinite(ms)) throw new IcsError("timestamp is not finite");
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()))
    throw new IcsError("timestamp out of range");
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines; drops other control chars. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(CONTROL_RE, "");
}

/**
 * Folds a content line to at most 75 octets per physical line (continuation lines start with one
 * space, so carry 74 octets of content). Never splits a UTF-8 sequence: breaks happen between
 * code points only. The result has no trailing CRLF.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const lines: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      lines.push(current);
      current = " ";
      currentBytes = 1;
      limit = 75;
    }
    current += char;
    currentBytes += bytes;
  }
  lines.push(current);
  return lines.join(CRLF);
}

function durationFromMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (abs === 0) return "PT0S";
  return `${sign}PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}`;
}

function zoneOffsetMinutes(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** UTC epoch ms of a wall-clock time in an IANA zone (a skipped local time resolves forward). */
function zonedToUtc(
  tz: string,
  ymd: Ymd,
  hour: number,
  minute: number,
): number {
  const wall = Date.UTC(ymd.y, ymd.m - 1, ymd.d, hour, minute);
  let guess = wall - zoneOffsetMinutes(tz, wall) * 60_000;
  guess = wall - zoneOffsetMinutes(tz, guess) * 60_000;
  return guess;
}

function alarmTrigger(alarm: IcsAlarm, start: Ymd): string {
  const daysBefore = alarm.daysBefore ?? 0;
  if (
    !Number.isInteger(daysBefore) ||
    daysBefore < 0 ||
    daysBefore > MAX_DAYS_BEFORE
  ) {
    throw new IcsError(
      `alarm.daysBefore must be an integer 0..${MAX_DAYS_BEFORE}`,
    );
  }
  if (!("time" in alarm)) {
    return daysBefore === 0 ? "PT0S" : `-P${daysBefore}D`;
  }
  const match = TIME_RE.exec(alarm.time);
  if (!match)
    throw new IcsError(`alarm.time: expected HH:MM, got "${alarm.time}"`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: alarm.tz });
  } catch {
    throw new IcsError(`alarm.tz: unknown time zone "${alarm.tz}"`);
  }
  const alarmDay = ymdFromDayNumber(dayNumber(start) - daysBefore);
  const alarmAt = zonedToUtc(
    alarm.tz,
    alarmDay,
    Number(match[1]),
    Number(match[2]),
  );
  const midnight = zonedToUtc(alarm.tz, start, 0, 0);
  return durationFromMinutes(Math.round((alarmAt - midnight) / 60_000));
}

function assertPlain(value: string, label: string): void {
  if (value.length === 0) throw new IcsError(`${label} must not be empty`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new IcsError(`${label} must not contain control characters`);
  }
}

function eventLines(event: IcsEvent, now: number): string[] {
  assertPlain(event.uid, "uid");
  if (event.summary.trim().length === 0)
    throw new IcsError("summary must not be empty");

  const startStr =
    typeof event.date === "string" ? event.date : event.date.start;
  const start = parseDate(startStr, "date.start");
  const startDay = dayNumber(start);
  let endDay = startDay + 1;
  if (typeof event.date !== "string") {
    endDay = dayNumber(parseDate(event.date.end, "date.end"));
    if (endDay <= startDay)
      throw new IcsError("date.end must be after date.start (exclusive end)");
  }

  const stamp = formatUtc(event.lastModified ?? now);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${formatDate(start)}`,
    `DTEND;VALUE=DATE:${formatDate(ymdFromDayNumber(endDay))}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description !== undefined && event.description.length > 0) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.url !== undefined) {
    let href: string;
    try {
      href = new URL(event.url).href;
    } catch {
      throw new IcsError("url is not a valid absolute url");
    }
    lines.push(`URL:${href}`);
  }
  if (event.categories !== undefined && event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
  }
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  if (event.sequence !== undefined) {
    if (!Number.isInteger(event.sequence) || event.sequence < 0) {
      throw new IcsError("sequence must be a non-negative integer");
    }
    lines.push(`SEQUENCE:${event.sequence}`);
  }
  lines.push("TRANSP:TRANSPARENT");
  if (event.lastModified !== undefined) {
    lines.push(`LAST-MODIFIED:${formatUtc(event.lastModified)}`);
  }
  if (event.alarm) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:${alarmTrigger(event.alarm, start)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildIcs(options: BuildIcsOptions): string {
  const { calendarName, events, prodId } = options;
  const refreshHours = options.refreshIntervalHours ?? 12;
  if (
    !Number.isFinite(refreshHours) ||
    refreshHours <= 0 ||
    refreshHours > 24 * 31
  ) {
    throw new IcsError(
      "refreshIntervalHours must be a positive number of hours (max 744)",
    );
  }
  assertPlain(prodId, "prodId");
  if (calendarName.trim().length === 0)
    throw new IcsError("calendarName must not be empty");
  const now = options.now ?? Date.now();
  const refresh = durationFromMinutes(Math.round(refreshHours * 60));

  const seen = new Set<string>();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeText(prodId)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `NAME:${escapeText(calendarName)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
  ];
  for (const event of events) {
    if (seen.has(event.uid)) throw new IcsError(`duplicate uid "${event.uid}"`);
    seen.add(event.uid);
    lines.push(...eventLines(event, now));
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Strong ETag (quoted sha256 hex) of the serialized calendar. */
export function etagFor(ics: string): string {
  return `"${createHash("sha256").update(ics, "utf8").digest("hex")}"`;
}
