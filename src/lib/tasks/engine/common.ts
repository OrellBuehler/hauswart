import { addDays, compareDates, diffDays } from "$lib/dates";
import type {
  Completion,
  DueKind,
  DueResult,
  DueStatus,
  EvalContext,
  Reason,
  Signal,
} from "./types";
import { SIGNAL_STALE_MS } from "./types";

type StatusContext = Pick<EvalContext, "today" | "graceDays" | "dueSoonDays">;

export function statusFor(
  dueDate: string,
  ctx: StatusContext,
  soonDays: number = ctx.dueSoonDays,
): DueStatus {
  if (compareDates(ctx.today, addDays(dueDate, ctx.graceDays)) > 0) {
    return "overdue";
  }
  if (compareDates(ctx.today, dueDate) >= 0) return "due";
  if (diffDays(dueDate, ctx.today) <= soonDays) return "open";
  return "ok";
}

export function datedResult(
  dueDate: string,
  dueKind: DueKind,
  occurrenceKey: string,
  ctx: StatusContext,
  extra: Partial<DueResult> = {},
): DueResult {
  return {
    status: statusFor(dueDate, ctx),
    dueDate,
    dueKind,
    occurrenceKey,
    reasons: [],
    ...extra,
  };
}

export function noDateResult(
  status: DueStatus,
  occurrenceKey: string,
  reasons: Reason[],
  extra: Partial<DueResult> = {},
): DueResult {
  return {
    status,
    dueDate: null,
    dueKind: "none",
    occurrenceKey,
    reasons,
    ...extra,
  };
}

export function latestByDate(
  completions: Completion[],
): Completion | undefined {
  let best: Completion | undefined;
  for (const c of completions) {
    if (
      !best ||
      c.completedDate > best.completedDate ||
      (c.completedDate === best.completedDate &&
        c.completedAt > best.completedAt)
    ) {
      best = c;
    }
  }
  return best;
}

export function latestByInstant(
  completions: Completion[],
): Completion | undefined {
  let best: Completion | undefined;
  for (const c of completions) {
    if (!best || c.completedAt > best.completedAt) best = c;
  }
  return best;
}

export type SignalLookup =
  | { ok: true; signal: Signal }
  | { ok: false; reason: "signal_missing" | "signal_stale" };

export function lookupSignal(
  ctx: Pick<EvalContext, "signals" | "now">,
  entityId: string,
  needs: "numeric" | "any",
): SignalLookup {
  const signal = ctx.signals[entityId];
  if (!signal) return { ok: false, reason: "signal_missing" };
  const hasNumeric =
    typeof signal.numeric === "number" && Number.isFinite(signal.numeric);
  const hasText = typeof signal.text === "string" && signal.text !== "";
  if (needs === "numeric" ? !hasNumeric : !hasNumeric && !hasText) {
    return { ok: false, reason: "signal_missing" };
  }
  if (ctx.now - signal.seenAt > SIGNAL_STALE_MS) {
    return { ok: false, reason: "signal_stale" };
  }
  return { ok: true, signal };
}
