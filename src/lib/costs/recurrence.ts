import type { CostRecurrenceFrequency } from "../api/enums";
import {
  addDays,
  compareDates,
  daysInMonth,
  formatDate,
  parseDate,
} from "../dates";

/** How many months one step of each frequency spans. */
const FREQUENCY_MONTHS: Record<CostRecurrenceFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * The rule of a recurring cost: an occurrence every `interval` months, quarters or years, counted from the month of
 * `startDate`, on `dayOfMonth` (clamped to the end of a shorter month). Occurrences are worked out from the start
 * month, never from the previous occurrence, so the 31st comes back after a short February. Dates are plain
 * `YYYY-MM-DD` values: nothing here depends on a time zone or on the night the clocks change.
 */
export interface RecurrenceRule {
  frequency: CostRecurrenceFrequency;
  interval: number;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
}

/** The most occurrences one scan looks at: 100 years of a monthly rule. */
const SCAN_LIMIT = 1200;

const monthIndex = (date: string) => {
  const { year, month } = parseDate(date);
  return year * 12 + (month - 1);
};

const stepOf = (rule: RecurrenceRule) =>
  FREQUENCY_MONTHS[rule.frequency] * rule.interval;

/** The k-th occurrence of the series (k = 0 is in the start month, which may lie before the start date). */
function occurrence(rule: RecurrenceRule, k: number): string {
  const total = monthIndex(rule.startDate) + k * stepOf(rule);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return formatDate(
    year,
    month,
    Math.min(rule.dayOfMonth, daysInMonth(year, month)),
  );
}

/** The first occurrence strictly after `after`, whatever the start date and end date say. */
function occurrenceAfter(rule: RecurrenceRule, after: string): string {
  const step = stepOf(rule);
  const behind = monthIndex(after) - monthIndex(rule.startDate);
  let k = Math.max(0, Math.floor(behind / step));
  while (compareDates(occurrence(rule, k), after) <= 0) k++;
  return occurrence(rule, k);
}

function withinEnd(rule: RecurrenceRule, date: string): string | null {
  return rule.endDate !== null && compareDates(date, rule.endDate) > 0
    ? null
    : date;
}

/**
 * The first occurrence strictly after `after`, never before the start date; null once the end date is passed. A date
 * before the series starts gives its first occurrence.
 */
export function nextOccurrenceAfter(
  rule: RecurrenceRule,
  after: string,
): string | null {
  const floor = addDays(rule.startDate, -1);
  return withinEnd(
    rule,
    occurrenceAfter(rule, compareDates(after, floor) < 0 ? floor : after),
  );
}

/** The first occurrence of the series: on or after the start date. */
export function firstOccurrence(rule: RecurrenceRule): string | null {
  return nextOccurrenceAfter(rule, addDays(rule.startDate, -1));
}

/** The first occurrence on or after `from` (and not before the start date); null once the series is over. */
export function nextOccurrenceOnOrAfter(
  rule: RecurrenceRule,
  from: string,
): string | null {
  return nextOccurrenceAfter(rule, addDays(from, -1));
}

/** The occurrences from `from` to `to`, both included, oldest first, at most `limit` of them. */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: string,
  to: string,
  limit = SCAN_LIMIT,
): string[] {
  const out: string[] = [];
  let next = nextOccurrenceOnOrAfter(rule, from);
  while (next !== null && compareDates(next, to) <= 0 && out.length < limit) {
    out.push(next);
    next = nextOccurrenceAfter(rule, next);
  }
  return out;
}

/**
 * What is due on `today`: the occurrences after the last one booked (all of them for a series that never ran) up to
 * and including today, oldest first, at most `limit` of them. A series that was down for a while therefore yields every
 * occurrence it missed, each once.
 */
export function dueOccurrences(
  rule: RecurrenceRule,
  lastBooked: string | null,
  today: string,
  limit = SCAN_LIMIT,
): string[] {
  const out: string[] = [];
  let next =
    lastBooked === null
      ? firstOccurrence(rule)
      : nextOccurrenceAfter(rule, lastBooked);
  while (
    next !== null &&
    compareDates(next, today) <= 0 &&
    out.length < limit
  ) {
    out.push(next);
    next = nextOccurrenceAfter(rule, next);
  }
  return out;
}
