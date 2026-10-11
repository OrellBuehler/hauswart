import { z } from "zod";
import { isValidDate } from "$lib/dates";

export const dateSchema = z
  .string()
  .refine(isValidDate, { message: "Expected a valid YYYY-MM-DD date" });
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Expected HH:MM" });

const positiveInt = z.number().int().min(1).max(3650);
const monthSchema = z.number().int().min(1).max(12);
const weekdaySchema = z.number().int().min(1).max(7);

export const intervalUnitSchema = z.enum(["day", "week", "month", "year"]);
export type IntervalUnit = z.infer<typeof intervalUnitSchema>;

export const seasonSchema = z.object({
  fromMonth: monthSchema,
  toMonth: monthSchema,
  every: positiveInt,
  unit: intervalUnitSchema,
});
export type Season = z.infer<typeof seasonSchema>;

/**
 * Completes the task by itself when a signal does something: a counter drops
 * by at least `minDrop` (a filter counter reset after the swap), or a state
 * changes to `to` (optionally from `from`). The completion is recorded as
 * done by the system; it is applied once per occurrence.
 */
export const autoCompleteRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("counter_reset"),
    entityId: z.string().min(1).max(255),
    minDrop: z.number().positive(),
  }),
  z.object({
    type: z.literal("state_change"),
    entityId: z.string().min(1).max(255),
    to: z.string().trim().min(1).max(255),
    from: z.string().trim().min(1).max(255).optional(),
  }),
]);
export type AutoCompleteRule = z.infer<typeof autoCompleteRuleSchema>;

const autoComplete = z.array(autoCompleteRuleSchema).max(5).optional();

export const intervalTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("interval"),
  every: positiveInt,
  unit: intervalUnitSchema,
  anchor: z.enum(["completion", "schedule"]),
  startDate: dateSchema,
  seasons: z.array(seasonSchema).max(12).optional(),
  autoComplete,
});
export type IntervalTrigger = z.infer<typeof intervalTriggerSchema>;

export const calendarTriggerSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("calendar"),
    freq: z.enum(["weekly", "monthly", "yearly"]),
    interval: positiveInt,
    byWeekday: z.array(weekdaySchema).min(1).max(7).optional(),
    byMonthDay: z
      .number()
      .int()
      .min(-31)
      .max(31)
      .refine((n) => n !== 0, { message: "byMonthDay must not be 0" })
      .optional(),
    nth: z
      .number()
      .int()
      .min(-5)
      .max(5)
      .refine((n) => n !== 0, { message: "nth must not be 0" })
      .optional(),
    byMonth: z.array(monthSchema).min(1).max(12).optional(),
    startDate: dateSchema,
    earlyDays: z.number().int().min(0).max(366).optional(),
    autoComplete,
  })
  .superRefine((t, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (t.byMonthDay !== undefined && t.nth !== undefined) {
      issue("byMonthDay and nth are mutually exclusive");
    }
    if (t.freq === "weekly") {
      if (t.byMonthDay !== undefined || t.nth !== undefined) {
        issue("weekly rules only take byWeekday");
      }
    } else if (t.byWeekday !== undefined && t.nth === undefined) {
      issue("byWeekday needs nth for monthly and yearly rules");
    }
    if (t.nth !== undefined && t.freq === "weekly") {
      issue("nth is not valid for weekly rules");
    }
  });
export type CalendarTrigger = z.infer<typeof calendarTriggerSchema>;

export const minPerPeriodTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("min_per_period"),
  period: z.enum(["week", "month", "quarter", "year"]),
  count: positiveInt,
  remindFromFraction: z.number().min(0).max(1).optional(),
  startDate: dateSchema.optional(),
  autoComplete,
});
export type MinPerPeriodTrigger = z.infer<typeof minPerPeriodTriggerSchema>;

/**
 * Due when the counter has grown by `threshold` since the last completion, or, with `orEvery`,
 * when that much time has passed since the last completion (since the task started when there
 * is none), whichever comes first. A service every 15,000 km or every 12 months.
 */
export const counterDeltaTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("counter_delta"),
  entityId: z.string().min(1),
  threshold: z.number().positive(),
  unit: z.string().optional(),
  orEvery: z
    .object({ every: positiveInt, unit: intervalUnitSchema })
    .optional(),
  autoCompleteOnReset: z.object({ minDrop: z.number().positive() }).optional(),
  autoComplete,
});
export type CounterDeltaTrigger = z.infer<typeof counterDeltaTriggerSchema>;

export const conditionOpSchema = z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]);
export type ConditionOp = z.infer<typeof conditionOpSchema>;

export const stateConditionTriggerSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("state_condition"),
    entityId: z.string().min(1),
    op: conditionOpSchema,
    value: z.union([z.string(), z.number()]),
    forMinutes: z.number().int().min(0).optional(),
    autoComplete,
    estimateFrom: z
      .object({
        entityId: z.string().min(1),
        target: z.number(),
        direction: z.enum(["down", "up"]),
      })
      .optional(),
  })
  .refine(
    (t) => t.op === "eq" || t.op === "ne" || typeof t.value === "number",
    { message: "gt/gte/lt/lte need a numeric value", path: ["value"] },
  );
export type StateConditionTrigger = z.infer<typeof stateConditionTriggerSchema>;

export const haCalendarTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("ha_calendar"),
  entityId: z.string().min(1),
  summaryMatch: z.string().optional(),
  offsetDays: z.number().int().min(-366).max(366),
  time: timeSchema.optional(),
  autoComplete,
});
export type HaCalendarTrigger = z.infer<typeof haCalendarTriggerSchema>;

export const oneOffTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("one_off"),
  date: dateSchema,
});
export type OneOffTrigger = z.infer<typeof oneOffTriggerSchema>;

export const keptBillTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("kept_bill"),
  billId: z.string().min(1),
  dueDate: dateSchema,
  status: z.enum(["open", "paid", "cancelled", "overdue"]),
});
export type KeptBillTrigger = z.infer<typeof keptBillTriggerSchema>;

export const warrantyTriggerSchema = z.object({
  v: z.literal(1),
  type: z.literal("warranty"),
  until: dateSchema,
  extendedUntil: dateSchema.optional(),
  leadDays: z.number().int().min(0).max(3650).optional(),
});
export type WarrantyTrigger = z.infer<typeof warrantyTriggerSchema>;

export const triggerSchema = z.discriminatedUnion("type", [
  intervalTriggerSchema,
  calendarTriggerSchema,
  minPerPeriodTriggerSchema,
  counterDeltaTriggerSchema,
  stateConditionTriggerSchema,
  haCalendarTriggerSchema,
  oneOffTriggerSchema,
  keptBillTriggerSchema,
  warrantyTriggerSchema,
]);
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerType = Trigger["type"];

export type Completion = {
  id: string;
  completedAt: number;
  completedDate: string;
  userId: string | null;
  kind: "done" | "skipped";
  counterValue?: number | null;
  occurrenceKey?: string | null;
};

export type Signal = {
  numeric?: number | null;
  text?: string | null;
  changedAt: number;
  seenAt: number;
  /** Who stored the reading; `manual` readings (typed in by a person) never go stale. */
  source?: string;
};
export type Signals = Record<string, Signal>;

export type Sample = { at: number; value: number };
export type Samples = Record<string, Sample[]>;

export type ExternalDates = Record<string, string[]>;

export type DueStatus =
  "ok" | "open" | "due" | "overdue" | "snoozed" | "unknown";
export type DueKind = "exact" | "deadline" | "estimated" | "condition" | "none";

export type Reason =
  | "never_completed"
  | "completed"
  | "skipped"
  | "snoozed"
  | "seasonal_boundary"
  | "missed_occurrences"
  | "period_satisfied"
  | "missed_previous_period"
  | "signal_missing"
  | "signal_stale"
  | "signal_unavailable"
  | "baseline_missing"
  | "counter_reset"
  | "condition_pending"
  | "condition_active"
  | "acknowledged"
  | "estimate_from_history"
  | "no_upcoming_events"
  | "no_occurrences"
  | "bill_cancelled"
  | "bill_overdue"
  | "warranty_expired"
  | "expired_archive";

export type Estimate = { date: string; confidence: "low" | "medium" };

export type DueResult = {
  status: DueStatus;
  dueDate: string | null;
  dueKind: DueKind;
  windowStart?: string;
  occurrenceKey: string;
  progress?: { current: number; target: number; unit?: string };
  estimate?: Estimate;
  missedCount?: number;
  reasons: Reason[];
};

export type EngineState = {
  counterBaseline?: number;
  activeSince?: number;
  dueSince?: number;
};

export type EvaluateInput = {
  trigger: Trigger;
  completions: Completion[];
  signals?: Signals;
  samples?: Samples;
  externalDates?: ExternalDates;
  state?: EngineState;
  today: string;
  now: number;
  tz: string;
  /** The day the task came into being (household zone); the time half of `orEvery` counts from here until the first completion. Defaults to `today`. */
  startedOn?: string;
  graceDays?: number;
  dueSoonDays?: number;
  snoozedUntil?: string | null;
};

export type EvalContext = {
  completions: Completion[];
  signals: Signals;
  samples: Samples;
  externalDates: ExternalDates;
  state: EngineState;
  today: string;
  now: number;
  tz: string;
  startedOn: string;
  graceDays: number;
  dueSoonDays: number;
};

export const DEFAULT_GRACE_DAYS = 0;
export const DEFAULT_DUE_SOON_DAYS = 7;
export const SIGNAL_STALE_MS = 24 * 60 * 60 * 1000;
/** The `source` of readings a person typed in. They are sparse by nature, so they do not go stale. */
export const MANUAL_SIGNAL_SOURCE = "manual";
