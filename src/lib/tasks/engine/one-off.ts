import { datedResult, noDateResult } from "./common";
import type { DueResult, EvalContext, OneOffTrigger } from "./types";

export function evaluateOneOff(
  trigger: OneOffTrigger,
  ctx: EvalContext,
): DueResult {
  if (ctx.completions.some((c) => c.kind === "done")) {
    return noDateResult("ok", trigger.date, ["completed"]);
  }
  if (ctx.completions.length > 0) {
    return noDateResult("ok", trigger.date, ["skipped"]);
  }
  return datedResult(trigger.date, "exact", trigger.date, ctx);
}
