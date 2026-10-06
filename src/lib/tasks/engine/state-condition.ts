import { addDays, compareDates, localDateOf } from "$lib/dates";
import { lookupSignal, noDateResult } from "./common";
import { estimateCrossing } from "./estimate";
import type {
  ConditionOp,
  DueResult,
  EvalContext,
  Reason,
  Signal,
  StateConditionTrigger,
} from "./types";

const UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);

function compareNumbers(op: ConditionOp, a: number, b: number): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
  }
}

function numericOf(signal: Signal): number | null {
  if (typeof signal.numeric === "number" && Number.isFinite(signal.numeric)) {
    return signal.numeric;
  }
  if (typeof signal.text === "string" && signal.text.trim() !== "") {
    const n = Number(signal.text);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function evalPredicate(
  signal: Signal,
  op: ConditionOp,
  value: string | number,
): boolean | "unavailable" {
  const text = signal.text?.trim().toLowerCase();
  if (text !== undefined && UNAVAILABLE_STATES.has(text)) return "unavailable";

  if (typeof value === "string" && (op === "eq" || op === "ne")) {
    const actual =
      text !== undefined && text !== ""
        ? text
        : signal.numeric != null
          ? String(signal.numeric)
          : null;
    if (actual === null) return false;
    const same = actual === value.trim().toLowerCase();
    return op === "eq" ? same : !same;
  }

  const expected = typeof value === "number" ? value : Number(value);
  const actual = numericOf(signal);
  if (actual === null || !Number.isFinite(expected)) return false;
  return compareNumbers(op, actual, expected);
}

export function evaluateStateCondition(
  trigger: StateConditionTrigger,
  ctx: EvalContext,
): DueResult {
  const idleKey = "s:none";
  const lookup = lookupSignal(ctx, trigger.entityId, "any");
  if (!lookup.ok) {
    return noDateResult("unknown", idleKey, [lookup.reason]);
  }
  const { signal } = lookup;
  const reasons: Reason[] = [];

  const predicate = evalPredicate(signal, trigger.op, trigger.value);
  if (predicate === "unavailable") reasons.push("signal_unavailable");
  let active = predicate === true;

  const since = ctx.state.activeSince ?? signal.changedAt;
  if (active && trigger.forMinutes) {
    if (since + trigger.forMinutes * 60_000 > ctx.now) {
      active = false;
      reasons.push("condition_pending");
    }
  }

  if (active) {
    const key = `s:${since}`;
    if (ctx.completions.some((c) => c.completedAt >= since)) {
      return noDateResult("ok", key, ["acknowledged"]);
    }
    const dueDate = localDateOf(ctx.tz, since);
    const overdue =
      compareDates(ctx.today, addDays(dueDate, ctx.graceDays)) > 0;
    return {
      status: overdue ? "overdue" : "due",
      dueDate,
      dueKind: "condition",
      occurrenceKey: key,
      reasons: [...reasons, "condition_active"],
    };
  }

  if (trigger.estimateFrom) {
    const estimate = estimateCrossing(
      ctx.samples[trigger.estimateFrom.entityId] ?? [],
      {
        target: trigger.estimateFrom.target,
        direction: trigger.estimateFrom.direction,
      },
      ctx.today,
      ctx.tz,
    );
    if (estimate) {
      return {
        status: "ok",
        dueDate: null,
        dueKind: "estimated",
        occurrenceKey: idleKey,
        estimate,
        reasons,
      };
    }
  }
  return noDateResult("ok", idleKey, reasons);
}
