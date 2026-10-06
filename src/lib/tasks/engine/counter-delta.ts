import { addDays, compareDates, localDateOf } from "$lib/dates";
import { latestByInstant, lookupSignal, noDateResult } from "./common";
import { estimateCrossing, estimateFromCompletions } from "./estimate";
import type {
  CounterDeltaTrigger,
  DueResult,
  EvalContext,
  Reason,
  Sample,
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

export function evaluateCounterDelta(
  trigger: CounterDeltaTrigger,
  ctx: EvalContext,
): DueResult {
  const key = `c:${latestByInstant(ctx.completions)?.id ?? "init"}`;

  const lookup = lookupSignal(ctx, trigger.entityId, "numeric");
  if (!lookup.ok) return noDateResult("unknown", key, [lookup.reason]);
  const currentValue = lookup.signal.numeric as number;

  const baselineSource = latestByInstant(
    ctx.completions.filter(
      (c) =>
        typeof c.counterValue === "number" && Number.isFinite(c.counterValue),
    ),
  );
  const baseline = baselineSource?.counterValue ?? ctx.state.counterBaseline;
  if (baseline === undefined || baseline === null) {
    return noDateResult("unknown", key, ["baseline_missing"]);
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
  );
  if (!estimate) {
    const fromHistory = estimateFromCompletions(ctx.completions);
    if (fromHistory) {
      const earliest = addDays(ctx.today, 1);
      estimate = {
        ...fromHistory,
        date: fromHistory.date < earliest ? earliest : fromHistory.date,
      };
      reasons.push("estimate_from_history");
    }
  }
  if (estimate) {
    return {
      status: "ok",
      dueDate: null,
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
