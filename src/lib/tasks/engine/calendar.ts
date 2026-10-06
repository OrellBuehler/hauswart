import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffDays,
  formatDate,
  isoWeekStart,
  maxDate,
  monthStart,
  nthWeekdayOfMonth,
  parseDate,
  weekday,
  yearStart,
} from "$lib/dates";
import { datedResult, noDateResult } from "./common";
import type { CalendarTrigger, DueResult, EvalContext, Reason } from "./types";

const MAX_PERIODS = 20_000;
const SPANS = [120, 450, 1600, 6000];
const LOOKBACK_PERIODS = 3;

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function monthDates(
  t: CalendarTrigger,
  year: number,
  month: number,
  startDay: number,
): string[] {
  if (t.nth !== undefined) {
    const weekdays = t.byWeekday ?? [weekday(t.startDate)];
    const dates = weekdays
      .map((wd) => nthWeekdayOfMonth(year, month, wd, t.nth as number))
      .filter((d): d is string => d !== null);
    return [...new Set(dates)].sort();
  }
  const dim = daysInMonth(year, month);
  let day: number;
  if (t.byMonthDay !== undefined) {
    day =
      t.byMonthDay > 0 ? Math.min(t.byMonthDay, dim) : dim + 1 + t.byMonthDay;
  } else {
    day = Math.min(startDay, dim);
  }
  return day >= 1 ? [formatDate(year, month, day)] : [];
}

function periodStart(t: CalendarTrigger, k: number): string {
  switch (t.freq) {
    case "weekly":
      return addDays(isoWeekStart(t.startDate), 7 * t.interval * k);
    case "monthly":
      return addMonths(monthStart(t.startDate), t.interval * k);
    case "yearly":
      return yearStart(addYears(t.startDate, t.interval * k));
  }
}

function periodOccurrences(t: CalendarTrigger, k: number): string[] {
  const start = periodStart(t, k);
  const startParts = parseDate(t.startDate);
  if (t.freq === "weekly") {
    const weekdays = sortedUnique(t.byWeekday ?? [weekday(t.startDate)]);
    return weekdays.map((wd) => addDays(start, wd - 1));
  }
  const { year, month } = parseDate(start);
  if (t.freq === "monthly") {
    return monthDates(t, year, month, startParts.day);
  }
  const months = sortedUnique(t.byMonth ?? [startParts.month]);
  return months.flatMap((m) => monthDates(t, year, m, startParts.day));
}

/** All occurrences from startDate up to and including `until`, ascending. */
function generateUntil(t: CalendarTrigger, until: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < MAX_PERIODS; k += 1) {
    if (periodStart(t, k) > until) break;
    for (const date of periodOccurrences(t, k)) {
      if (date < t.startDate || date > until) continue;
      if (t.freq !== "yearly" && t.byMonth) {
        if (!t.byMonth.includes(parseDate(date).month)) continue;
      }
      out.push(date);
    }
  }
  return out;
}

export function calendarOccurrences(
  trigger: CalendarTrigger,
  from: string,
  to: string,
): string[] {
  return generateUntil(trigger, to).filter((d) => d >= from);
}

function periodStep(
  t: CalendarTrigger,
  today: string,
  direction: -1 | 1,
): string {
  const n = LOOKBACK_PERIODS * t.interval * direction;
  switch (t.freq) {
    case "weekly":
      return addDays(today, 7 * n);
    case "monthly":
      return addMonths(today, n);
    case "yearly":
      return addYears(today, n);
  }
}

function earlyWindow(t: CalendarTrigger, occurrences: string[]): number {
  if (t.earlyDays !== undefined) return t.earlyDays;
  let minGap = Infinity;
  for (let i = 1; i < occurrences.length; i += 1) {
    const gap = diffDays(occurrences[i], occurrences[i - 1]);
    if (gap < minGap) minGap = gap;
  }
  if (!Number.isFinite(minGap)) minGap = 7;
  return Math.min(7, Math.floor(minGap / 2));
}

export function evaluateCalendar(
  trigger: CalendarTrigger,
  ctx: EvalContext,
): DueResult {
  let occurrences: string[] = [];
  for (const span of SPANS) {
    occurrences = generateUntil(
      trigger,
      addDays(maxDate(ctx.today, trigger.startDate), span),
    );
    const upcoming = occurrences.filter((d) => d > ctx.today).length;
    if (upcoming >= 2) break;
  }
  if (occurrences.length === 0) {
    return noDateResult("unknown", "none", ["no_occurrences"]);
  }

  const early = earlyWindow(trigger, occurrences);
  const lows = occurrences.map((d) => addDays(d, -early));
  const satisfied = occurrences.map(() => false);
  const indexOf = new Map(occurrences.map((d, i) => [d, i]));

  for (const c of ctx.completions) {
    const explicit = c.occurrenceKey ? indexOf.get(c.occurrenceKey) : undefined;
    if (explicit !== undefined) {
      satisfied[explicit] = true;
      continue;
    }
    let lo = 0;
    let hi = lows.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lows[mid] <= c.completedDate) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found >= 0) satisfied[found] = true;
  }

  const lookbackStart = periodStep(trigger, ctx.today, -1);
  let missed = 0;
  let pick = -1;
  for (let i = 0; i < occurrences.length; i += 1) {
    if (satisfied[i]) continue;
    if (occurrences[i] < lookbackStart) {
      missed += 1;
      continue;
    }
    pick = i;
    break;
  }
  if (pick < 0) return noDateResult("unknown", "none", ["no_occurrences"]);

  const reasons: Reason[] = [];
  if (ctx.completions.length === 0) reasons.push("never_completed");
  const extra: Partial<DueResult> = { reasons };
  if (missed > 0) {
    extra.missedCount = missed;
    reasons.push("missed_occurrences");
  }
  return datedResult(occurrences[pick], "exact", occurrences[pick], ctx, extra);
}
