import {
  addDays,
  diffDays,
  isoWeekEnd,
  isoWeekStart,
  monthEnd,
  monthStart,
  quarterEnd,
  quarterStart,
  yearEnd,
  yearStart,
} from "$lib/dates";
import type {
  DueResult,
  EvalContext,
  MinPerPeriodTrigger,
  Reason,
} from "./types";

const DEFAULT_REMIND_FRACTION = 0.6;

export function periodBounds(
  period: MinPerPeriodTrigger["period"],
  date: string,
): { start: string; end: string } {
  switch (period) {
    case "week":
      return { start: isoWeekStart(date), end: isoWeekEnd(date) };
    case "month":
      return { start: monthStart(date), end: monthEnd(date) };
    case "quarter":
      return { start: quarterStart(date), end: quarterEnd(date) };
    case "year":
      return { start: yearStart(date), end: yearEnd(date) };
  }
}

export function evaluateMinPerPeriod(
  trigger: MinPerPeriodTrigger,
  ctx: EvalContext,
): DueResult {
  const current = periodBounds(trigger.period, ctx.today);
  const countIn = (start: string, end: string) =>
    ctx.completions.filter(
      (c) =>
        c.kind === "done" && c.completedDate >= start && c.completedDate <= end,
    ).length;

  const reasons: Reason[] = [];
  const previous = periodBounds(trigger.period, addDays(current.start, -1));
  if (
    trigger.startDate !== undefined &&
    trigger.startDate <= previous.start &&
    countIn(previous.start, previous.end) < trigger.count
  ) {
    reasons.push("missed_previous_period");
  }

  const done = countIn(current.start, current.end);
  if (done >= trigger.count) {
    const nextStart = addDays(current.end, 1);
    reasons.push("period_satisfied");
    return {
      status: "ok",
      dueDate: periodBounds(trigger.period, nextStart).end,
      dueKind: "deadline",
      windowStart: nextStart,
      occurrenceKey: `p:${nextStart}`,
      reasons,
    };
  }

  const length = diffDays(current.end, current.start) + 1;
  const fraction = trigger.remindFromFraction ?? DEFAULT_REMIND_FRACTION;
  const remindFrom = addDays(current.start, Math.floor(fraction * length));
  return {
    status: ctx.today >= remindFrom ? "due" : "open",
    dueDate: current.end,
    dueKind: "deadline",
    windowStart: current.start,
    occurrenceKey: `p:${current.start}`,
    progress: { current: done, target: trigger.count },
    reasons,
  };
}
