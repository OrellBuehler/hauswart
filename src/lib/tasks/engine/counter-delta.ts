import { addDays, compareDates, localDateOf } from "$lib/dates";
import {
  datedResult,
  latestByInstant,
  lookupSignal,
  noDateResult,
  statusFor,
} from "./common";
import {
  SPARSE_WINDOWS_DAYS,
  estimateCrossing,
  estimateFromCompletions,
} from "./estimate";
import { addInterval } from "./interval";
import {
  MANUAL_SIGNAL_SOURCE,
  type CounterDeltaTrigger,
  type DueResult,
  type EvalContext,
  type Reason,
  type Sample,
} from "./types";

export function detectCounterReset(
  prevValue: number,
  newValue: number,
  minDrop: number,
): boolean {
  if (!Number.isFinite(prevValue) || !Number.isFinite(newValue)) return false;
  return newValue < prevValue && prevValue - newValue >= minDrop;
}

function sinceLastReset(samples: Sample[]): Sample[] {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  let start = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].value < sorted[i - 1].value) start = i;
  }
  return sorted.slice(start);
}

/**
 * The date the time half of `orEvery` falls on: the interval after the last completion (done or
 * skipped, the one the occurrence key names), or after the task started when there is none.
 */
function timeLimit(
  trigger: CounterDeltaTrigger,
  ctx: EvalContext,
): string | null {
  if (!trigger.orEvery) return null;
  const base = latestByInstant(ctx.completions)?.completedDate ?? ctx.startedOn;
  return addInterval(base, trigger.orEvery.every, trigger.orEvery.unit);
}

export function evaluateCounterDelta(
  trigger: CounterDeltaTrigger,
  ctx: EvalContext,
): DueResult {
  const key = `c:${latestByInstant(ctx.completions)?.id ?? "init"}`;
  const limit = timeLimit(trigger, ctx);

  // Without a usable counter the counter half says nothing; the time half still does.
  const withoutCounter = (reason: Reason): DueResult =>
    limit === null
      ? noDateResult("unknown", key, [reason])
      : datedResult(limit, "exact", key, ctx, { reasons: [reason] });

  const lookup = lookupSignal(ctx, trigger.entityId, "numeric");
  if (!lookup.ok) return withoutCounter(lookup.reason);
  const currentValue = lookup.signal.numeric as number;

  const baselineSource = latestByInstant(
    ctx.completions.filter(
      (c) =>
        typeof c.counterValue === "number" && Number.isFinite(c.counterValue),
    ),
  );
  const baseline = baselineSource?.counterValue ?? ctx.state.counterBaseline;
  if (baseline === undefined || baseline === null) {
    return withoutCounter("baseline_missing");
  }

  const reasons: Reason[] = [];
  let delta = currentValue - baseline;
  let effectiveBaseline = baseline;
  if (delta < 0) {
    delta = currentValue;
    effectiveBaseline = 0;
    reasons.push("counter_reset");
  }

  const progress: DueResult["progress"] = {
    current: delta,
    target: trigger.threshold,
  };
  if (trigger.unit !== undefined) progress.unit = trigger.unit;

  if (delta >= trigger.threshold) {
    const dueDate = localDateOf(ctx.tz, ctx.state.dueSince ?? ctx.now);
    // The time limit passed before the counter got there: it set the date.
    if (limit !== null && limit < dueDate) {
      return datedResult(limit, "exact", key, ctx, { progress, reasons });
    }
    const overdue =
      compareDates(ctx.today, addDays(dueDate, ctx.graceDays)) > 0;
    return {
      status: overdue ? "overdue" : "due",
      dueDate,
      dueKind: "condition",
      occurrenceKey: key,
      progress,
      reasons,
    };
  }

  let estimate = estimateCrossing(
    sinceLastReset(ctx.samples[trigger.entityId] ?? []),
    {
      target: effectiveBaseline + trigger.threshold,
      direction: "up",
      current: currentValue,
    },
    ctx.today,
    ctx.tz,
    lookup.signal.source === MANUAL_SIGNAL_SOURCE
      ? SPARSE_WINDOWS_DAYS
      : undefined,
  );
  let fromHistory = false;
  if (!estimate) {
    const history = estimateFromCompletions(ctx.completions);
    if (history) {
      const earliest = addDays(ctx.today, 1);
      estimate = {
        ...history,
        date: history.date < earliest ? earliest : history.date,
      };
      fromHistory = true;
    }
  }

  // The earlier of the two dates is the one shown (`shownDate`). The time limit is certain, the
  // estimate only a guess, so the guess is shown only when the counter is expected to get there
  // first; the limit stays the due date either way, because it is a hard one: the status, the
  // "due soon" notification and the calendar feed are about it, and they must not lose it.
  if (limit !== null && !(estimate && estimate.date < limit)) {
    return datedResult(limit, "exact", key, ctx, { progress, reasons });
  }
  if (estimate) {
    if (fromHistory) reasons.push("estimate_from_history");
    return {
      status: limit === null ? "ok" : statusFor(limit, ctx),
      dueDate: limit,
      dueKind: "estimated",
      occurrenceKey: key,
      progress,
      estimate,
      reasons,
    };
  }
  return {
    status: "ok",
    dueDate: null,
    dueKind: "none",
    occurrenceKey: key,
    progress,
    reasons,
  };
}
