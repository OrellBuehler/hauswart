import { addDays, maxDate } from "$lib/dates";
import { datedResult, noDateResult } from "./common";
import type { DueResult, EvalContext, Reason, WarrantyTrigger } from "./types";

export const WARRANTY_DEFAULT_LEAD_DAYS = 30;
export const WARRANTY_ARCHIVE_AFTER_DAYS = 30;

export function evaluateWarranty(
  trigger: WarrantyTrigger,
  ctx: EvalContext,
): DueResult {
  const dueDate = trigger.extendedUntil
    ? maxDate(trigger.until, trigger.extendedUntil)
    : trigger.until;
  const key = `w:${dueDate}`;
  if (ctx.completions.some((c) => c.occurrenceKey === key)) {
    return noDateResult("ok", key, ["completed"]);
  }
  const reasons: Reason[] = [];
  if (ctx.today > dueDate) reasons.push("warranty_expired");
  if (ctx.today > addDays(dueDate, WARRANTY_ARCHIVE_AFTER_DAYS)) {
    reasons.push("expired_archive");
  }
  return datedResult(
    dueDate,
    "deadline",
    key,
    { ...ctx, dueSoonDays: trigger.leadDays ?? WARRANTY_DEFAULT_LEAD_DAYS },
    { reasons },
  );
}
