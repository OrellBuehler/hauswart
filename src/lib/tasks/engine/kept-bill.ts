import { compareDates } from "$lib/dates";
import { datedResult, noDateResult } from "./common";
import type { DueResult, EvalContext, KeptBillTrigger } from "./types";

export function evaluateKeptBill(
  trigger: KeptBillTrigger,
  ctx: EvalContext,
): DueResult {
  const key = `bill:${trigger.billId}`;
  if (trigger.status === "paid") return noDateResult("ok", key, ["completed"]);
  if (trigger.status === "cancelled") {
    return noDateResult("ok", key, ["completed", "bill_cancelled"]);
  }
  const handled = ctx.completions.filter((c) => c.occurrenceKey === key);
  if (handled.length > 0) {
    return noDateResult("ok", key, [
      handled.some((c) => c.kind === "done") ? "completed" : "skipped",
    ]);
  }
  const result = datedResult(trigger.dueDate, "deadline", key, ctx);
  if (
    trigger.status === "overdue" &&
    compareDates(ctx.today, trigger.dueDate) > 0
  ) {
    result.status = "overdue";
    result.reasons.push("bill_overdue");
  }
  return result;
}
