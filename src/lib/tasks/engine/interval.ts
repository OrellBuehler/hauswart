import {
  addDays,
  addMonths,
  addYears,
  diffDays,
  formatDate,
  isValidDate,
  maxDate,
  parseDate,
} from "$lib/dates";
import { datedResult, latestByDate } from "./common";
import type {
  EvalContext,
  IntervalTrigger,
  IntervalUnit,
  Reason,
  DueResult,
} from "./types";

const MAX_CHAIN = 50_000;
const BOUNDARY_SCAN_MONTHS = 13;

export function addInterval(
  date: string,
  every: number,
  unit: IntervalUnit,
): string {
  switch (unit) {
    case "day":
      return addDays(date, every);
    case "week":
      return addDays(date, 7 * every);
    case "month":
      return addMonths(date, every);
    case "year":
      return addYears(date, every);
  }
}

export function monthInRange(
  month: number,
  fromMonth: number,
  toMonth: number,
): boolean {
  return fromMonth <= toMonth
    ? month >= fromMonth && month <= toMonth
    : month >= fromMonth || month <= toMonth;
}

function seasonIndexOfMonth(trigger: IntervalTrigger, month: number): number {
  return (trigger.seasons ?? []).findIndex((s) =>
    monthInRange(month, s.fromMonth, s.toMonth),
  );
}

export function intervalAt(
  trigger: IntervalTrigger,
  date: string,
): { every: number; unit: IntervalUnit } {
  const idx = seasonIndexOfMonth(trigger, parseDate(date).month);
  return idx < 0
    ? trigger
    : (trigger.seasons as NonNullable<typeof trigger.seasons>)[idx];
}

function nextSeasonBoundary(
  trigger: IntervalTrigger,
  after: string,
): string | null {
  let { year, month } = parseDate(after);
  let prev = seasonIndexOfMonth(trigger, month);
  for (let i = 0; i < BOUNDARY_SCAN_MONTHS; i += 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const idx = seasonIndexOfMonth(trigger, month);
    if (idx !== prev) return formatDate(year, month, 1);
    prev = idx;
  }
  return null;
}

/**
 * Next due date counted from `base`: base plus the interval of the season active at base.
 * Season boundaries before that date re-evaluate with the new season's interval; a shorter
 * result wins, but never lands before the boundary itself.
 */
export function nextFrom(
  trigger: IntervalTrigger,
  base: string,
): { date: string; seasonal: boolean } {
  const start = intervalAt(trigger, base);
  let candidate = addInterval(base, start.every, start.unit);
  let seasonal = false;
  if (!trigger.seasons?.length) return { date: candidate, seasonal };
  let from = base;
  for (let i = 0; i < 24; i += 1) {
    const boundary = nextSeasonBoundary(trigger, from);
    if (!boundary || boundary > candidate) break;
    const next = intervalAt(trigger, boundary);
    const alt = maxDate(boundary, addInterval(base, next.every, next.unit));
    if (alt < candidate) {
      candidate = alt;
      seasonal = true;
    }
    from = boundary;
  }
  return { date: candidate, seasonal };
}

class Schedule {
  private chain: string[] = [];
  private readonly seasonal: boolean;

  constructor(private readonly trigger: IntervalTrigger) {
    this.seasonal = (trigger.seasons?.length ?? 0) > 0;
    this.chain.push(trigger.startDate);
  }

  at(k: number): string {
    const t = this.trigger;
    if (this.seasonal) {
      while (this.chain.length <= k && this.chain.length < MAX_CHAIN) {
        this.chain.push(nextFrom(t, this.chain[this.chain.length - 1]).date);
      }
      return this.chain[Math.min(k, this.chain.length - 1)];
    }
    return addInterval(t.startDate, k * t.every, t.unit);
  }

  floorIndex(date: string): number {
    const t = this.trigger;
    if (date < t.startDate) return -1;
    if (this.seasonal) {
      let k = 0;
      while (this.at(k + 1) <= date && k + 1 < MAX_CHAIN) k += 1;
      return k;
    }
    if (t.unit === "day" || t.unit === "week") {
      const gap = t.every * (t.unit === "week" ? 7 : 1);
      return Math.floor(diffDays(date, t.startDate) / gap);
    }
    const a = parseDate(t.startDate);
    const b = parseDate(date);
    const months = (b.year - a.year) * 12 + (b.month - a.month);
    const step = t.every * (t.unit === "year" ? 12 : 1);
    let k = Math.max(0, Math.floor(months / step));
    while (k > 0 && this.at(k) > date) k -= 1;
    while (this.at(k + 1) <= date) k += 1;
    return k;
  }

  windowStart(k: number): string {
    const here = this.at(k);
    const gap =
      k === 0 ? diffDays(this.at(1), here) : diffDays(here, this.at(k - 1));
    return addDays(here, -Math.floor(gap / 2));
  }

  indexOfOccurrence(key: string): number | null {
    if (!isValidDate(key)) return null;
    const k = this.floorIndex(key);
    return k >= 0 && this.at(k) === key ? k : null;
  }
}

export function evaluateInterval(
  trigger: IntervalTrigger,
  ctx: EvalContext,
): DueResult {
  const reasons: Reason[] = [];
  if (ctx.completions.length === 0) reasons.push("never_completed");

  if (trigger.anchor === "completion") {
    const last = latestByDate(ctx.completions);
    let due = trigger.startDate;
    if (last) {
      const next = nextFrom(trigger, last.completedDate);
      due = maxDate(trigger.startDate, next.date);
      if (next.seasonal) reasons.push("seasonal_boundary");
    }
    return datedResult(due, "exact", due, ctx, { reasons });
  }

  const schedule = new Schedule(trigger);
  let lastSatisfied = -1;
  for (const c of ctx.completions) {
    let idx: number | null = null;
    if (c.occurrenceKey) idx = schedule.indexOfOccurrence(c.occurrenceKey);
    if (idx === null) {
      const floor = schedule.floorIndex(c.completedDate);
      idx =
        schedule.windowStart(floor + 1) <= c.completedDate ? floor + 1 : floor;
    }
    if (idx > lastSatisfied) lastSatisfied = idx;
  }
  const due = schedule.at(lastSatisfied + 1);
  return datedResult(due, "exact", due, ctx, { reasons });
}
