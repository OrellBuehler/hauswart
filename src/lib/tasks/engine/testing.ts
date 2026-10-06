import type { z } from "zod";
import { zonedTimeToInstant } from "$lib/dates";
import { evaluateTask } from "./evaluate";
import {
  calendarTriggerSchema,
  counterDeltaTriggerSchema,
  haCalendarTriggerSchema,
  intervalTriggerSchema,
  keptBillTriggerSchema,
  minPerPeriodTriggerSchema,
  oneOffTriggerSchema,
  stateConditionTriggerSchema,
  warrantyTriggerSchema,
  type Completion,
  type DueResult,
  type EvaluateInput,
  type Trigger,
} from "./types";

export const TZ = "Europe/Zurich";

export function at(date: string, time = "12:00"): number {
  return zonedTimeToInstant(date, time, TZ);
}

export function done(
  date: string,
  overrides: Partial<Completion> & { time?: string } = {},
): Completion {
  const { time = "10:00", ...rest } = overrides;
  return {
    id: `c-${date}-${time}`,
    completedAt: at(date, time),
    completedDate: date,
    userId: null,
    kind: "done",
    ...rest,
  };
}

export function skipped(
  date: string,
  overrides: Partial<Completion> & { time?: string } = {},
): Completion {
  return done(date, { ...overrides, kind: "skipped" });
}

type Input<S extends z.ZodType> = Omit<z.input<S>, "v" | "type">;

export const trigger = {
  interval: (o: Input<typeof intervalTriggerSchema>) =>
    intervalTriggerSchema.parse({ v: 1, type: "interval", ...o }),
  calendar: (o: Input<typeof calendarTriggerSchema>) =>
    calendarTriggerSchema.parse({ v: 1, type: "calendar", ...o }),
  minPerPeriod: (o: Input<typeof minPerPeriodTriggerSchema>) =>
    minPerPeriodTriggerSchema.parse({ v: 1, type: "min_per_period", ...o }),
  counterDelta: (o: Input<typeof counterDeltaTriggerSchema>) =>
    counterDeltaTriggerSchema.parse({ v: 1, type: "counter_delta", ...o }),
  stateCondition: (o: Input<typeof stateConditionTriggerSchema>) =>
    stateConditionTriggerSchema.parse({ v: 1, type: "state_condition", ...o }),
  haCalendar: (o: Input<typeof haCalendarTriggerSchema>) =>
    haCalendarTriggerSchema.parse({ v: 1, type: "ha_calendar", ...o }),
  oneOff: (o: Input<typeof oneOffTriggerSchema>) =>
    oneOffTriggerSchema.parse({ v: 1, type: "one_off", ...o }),
  keptBill: (o: Input<typeof keptBillTriggerSchema>) =>
    keptBillTriggerSchema.parse({ v: 1, type: "kept_bill", ...o }),
  warranty: (o: Input<typeof warrantyTriggerSchema>) =>
    warrantyTriggerSchema.parse({ v: 1, type: "warranty", ...o }),
};

export function evaluate(
  t: Trigger,
  today: string,
  overrides: Partial<Omit<EvaluateInput, "trigger" | "today">> = {},
): DueResult {
  return evaluateTask({
    trigger: t,
    completions: [],
    today,
    now: at(today),
    tz: TZ,
    ...overrides,
  });
}
