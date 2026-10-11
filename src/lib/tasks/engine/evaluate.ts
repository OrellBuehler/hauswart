import { evaluateCalendar } from "./calendar";
import { evaluateCounterDelta } from "./counter-delta";
import { evaluateHaCalendar } from "./ha-calendar";
import { evaluateInterval } from "./interval";
import { evaluateKeptBill } from "./kept-bill";
import { evaluateMinPerPeriod } from "./min-per-period";
import { evaluateOneOff } from "./one-off";
import { evaluateStateCondition } from "./state-condition";
import { evaluateWarranty } from "./warranty";
import {
  DEFAULT_DUE_SOON_DAYS,
  DEFAULT_GRACE_DAYS,
  type DueResult,
  type EvalContext,
  type EvaluateInput,
  type Trigger,
} from "./types";

function dispatch(trigger: Trigger, ctx: EvalContext): DueResult {
  switch (trigger.type) {
    case "interval":
      return evaluateInterval(trigger, ctx);
    case "calendar":
      return evaluateCalendar(trigger, ctx);
    case "min_per_period":
      return evaluateMinPerPeriod(trigger, ctx);
    case "counter_delta":
      return evaluateCounterDelta(trigger, ctx);
    case "state_condition":
      return evaluateStateCondition(trigger, ctx);
    case "ha_calendar":
      return evaluateHaCalendar(trigger, ctx);
    case "one_off":
      return evaluateOneOff(trigger, ctx);
    case "kept_bill":
      return evaluateKeptBill(trigger, ctx);
    case "warranty":
      return evaluateWarranty(trigger, ctx);
  }
}

export function evaluateTask(input: EvaluateInput): DueResult {
  const ctx: EvalContext = {
    completions: input.completions,
    signals: input.signals ?? {},
    samples: input.samples ?? {},
    externalDates: input.externalDates ?? {},
    state: input.state ?? {},
    today: input.today,
    now: input.now,
    tz: input.tz,
    startedOn: input.startedOn ?? input.today,
    graceDays: input.graceDays ?? DEFAULT_GRACE_DAYS,
    dueSoonDays: input.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS,
  };
  const result = dispatch(input.trigger, ctx);
  if (
    input.snoozedUntil &&
    input.snoozedUntil > input.today &&
    (result.status === "open" ||
      result.status === "due" ||
      result.status === "overdue")
  ) {
    return {
      ...result,
      status: "snoozed",
      reasons: [...result.reasons, "snoozed"],
    };
  }
  return result;
}
