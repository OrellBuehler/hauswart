import { addDays, weekday } from "$lib/dates";
import type {
  CalendarTrigger,
  CounterDeltaTrigger,
  HaCalendarTrigger,
  IntervalTrigger,
  KeptBillTrigger,
  MinPerPeriodTrigger,
  OneOffTrigger,
  StateConditionTrigger,
  Trigger,
  TriggerType,
  WarrantyTrigger,
} from "$lib/tasks/engine/types";

/** A trigger while it is being edited: the discriminant is always set, every other field may still be missing. */
type Draft<T extends { type: string; v: 1 }> = Pick<T, "type" | "v"> &
  Partial<Omit<T, "type" | "v">>;

export type IntervalDraft = Draft<IntervalTrigger>;
export type CalendarDraft = Draft<CalendarTrigger>;
export type MinPerPeriodDraft = Draft<MinPerPeriodTrigger>;
export type OneOffDraft = Draft<OneOffTrigger>;
export type CounterDeltaDraft = Draft<CounterDeltaTrigger>;
export type StateConditionDraft = Draft<StateConditionTrigger>;
export type HaCalendarDraft = Draft<HaCalendarTrigger>;
export type WarrantyDraft = Draft<WarrantyTrigger>;

export type TriggerDraft =
  | IntervalDraft
  | CalendarDraft
  | MinPerPeriodDraft
  | OneOffDraft
  | CounterDeltaDraft
  | StateConditionDraft
  | HaCalendarDraft
  | WarrantyDraft
  | KeptBillTrigger;

export const EDITABLE_TYPES: TriggerType[] = [
  "interval",
  "calendar",
  "min_per_period",
  "one_off",
  "warranty",
  "counter_delta",
  "state_condition",
  "ha_calendar",
];

/** Types that need a Home Assistant connection to deliver readings. */
export const ADVANCED_TYPES: TriggerType[] = [
  "counter_delta",
  "state_condition",
  "ha_calendar",
];

export function defaultTrigger(type: TriggerType, today: string): TriggerDraft {
  switch (type) {
    case "interval":
      return {
        v: 1,
        type,
        every: 3,
        unit: "month",
        anchor: "completion",
        startDate: today,
      };
    case "calendar":
      return {
        v: 1,
        type,
        freq: "weekly",
        interval: 1,
        byWeekday: [weekday(today)],
        startDate: today,
      };
    case "min_per_period":
      return { v: 1, type, period: "month", count: 1 };
    case "one_off":
      return { v: 1, type, date: addDays(today, 7) };
    case "warranty":
      return { v: 1, type, until: addDays(today, 365) };
    case "counter_delta":
      return { v: 1, type, entityId: "", threshold: 100 };
    case "state_condition":
      return { v: 1, type, entityId: "", op: "gt" };
    case "ha_calendar":
      return { v: 1, type, entityId: "", offsetDays: 0 };
    case "kept_bill":
      throw new Error("kept_bill triggers are created by their integration");
  }
}

/** Every trigger of this type as the form edits it (a copy, safe to mutate). */
export function draftOf(trigger: Trigger): TriggerDraft {
  return structuredClone(trigger) as TriggerDraft;
}
