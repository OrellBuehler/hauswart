import { z } from "zod";
import {
  triggerSchema,
  type Trigger,
  type TriggerType,
} from "../../../src/lib/tasks/engine/types";
import { ToolError } from "../errors";

interface TriggerDoc {
  what: string;
  example: Record<string, unknown>;
}

/**
 * One entry per engine trigger type; a new type in the engine breaks the build
 * here until it is documented for the model. Examples are validated by a test.
 */
export const TRIGGER_DOCS: Record<TriggerType, TriggerDoc> = {
  interval: {
    what: "Repeats every N days/weeks/months/years. anchor: completion = counted from the last completion (descaling every 3 months after it was done), schedule = fixed grid from startDate. Optional seasons[]: {fromMonth,toMonth,every,unit} changes the interval in some months.",
    example: {
      type: "interval",
      every: 3,
      unit: "month",
      anchor: "completion",
      startDate: "2026-01-15",
    },
  },
  calendar: {
    what: "Calendar rule. freq weekly|monthly|yearly, interval N. weekly: byWeekday [1=Mon..7=Sun]. monthly/yearly: byMonthDay (1..31, -1 = last day) or byWeekday plus nth (1 = first, -1 = last). yearly: byMonth [1..12]. earlyDays: may be done this many days early.",
    example: {
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byWeekday: [6],
      nth: 1,
      startDate: "2026-01-01",
    },
  },
  min_per_period: {
    what: "At least `count` times per week|month|quarter|year, any day (watering at least twice a week). Optional remindFromFraction 0..1 of the period.",
    example: { type: "min_per_period", period: "week", count: 2 },
  },
  one_off: {
    what: "Once, on a date.",
    example: { type: "one_off", date: "2026-12-24" },
  },
  warranty: {
    what: "Reminder before a warranty ends. Optional extendedUntil and leadDays.",
    example: { type: "warranty", until: "2027-11-20", leadDays: 60 },
  },
  counter_delta: {
    what: 'Due when a counter entity grew by `threshold` since the last completion (a Home Assistant counter, or a vehicle\'s odometer: entityId "odometer:<asset id>", fed by record_odometer). Optional orEvery {every, unit day|week|month|year}: due when that much time has passed since the last completion (or since the task was created), whichever comes first - a service every 15000 km or every 12 months; the time part keeps working without a counter reading. Optional autoComplete: [{type: "counter_reset", entityId, minDrop} | {type: "state_change", entityId, to, from?}] completes the task by itself when the counter drops or a state changes (any recurring trigger takes it).',
    example: {
      type: "counter_delta",
      entityId: "sensor.example_runtime",
      threshold: 500,
      unit: "h",
      autoComplete: [
        {
          type: "counter_reset",
          entityId: "sensor.example_runtime",
          minDrop: 100,
        },
      ],
    },
  },
  state_condition: {
    what: "Due while an entity's state matches (op eq|ne|gt|gte|lt|lte; gt/gte/lt/lte need a number). Optional forMinutes (needs the Home Assistant adapter).",
    example: {
      type: "state_condition",
      entityId: "sensor.example_filter_life",
      op: "lt",
      value: 10,
    },
  },
  ha_calendar: {
    what: "Follows events of a Home Assistant calendar (waste collection); offsetDays shifts the date, summaryMatch filters events (needs the Home Assistant adapter).",
    example: {
      type: "ha_calendar",
      entityId: "calendar.example_waste",
      summaryMatch: "paper",
      offsetDays: -1,
    },
  },
  kept_bill: {
    what: "A bill from the finance app; normally created by that integration, not by hand.",
    example: {
      type: "kept_bill",
      billId: "bill-1",
      dueDate: "2026-11-30",
      status: "open",
    },
  },
};

export const TRIGGER_TYPES = Object.keys(TRIGGER_DOCS) as TriggerType[];

/** The trigger block of the tool descriptions. */
export function triggerHelp(): string {
  const lines = TRIGGER_TYPES.map((type) => {
    const { what, example } = TRIGGER_DOCS[type];
    return `- ${type}: ${what} Example: ${JSON.stringify(example)}`;
  });
  return `trigger is a JSON object; "v":1 is added for you. Types:\n${lines.join("\n")}`;
}

/** Input shape for a trigger argument: loose here, validated with the engine schema in the handler for clear messages. */
export const triggerInput = z.looseObject({ type: z.string() });

export function parseTrigger(raw: Record<string, unknown>): Trigger {
  const type = raw.type;
  if (typeof type !== "string" || !(type in TRIGGER_DOCS)) {
    throw new ToolError(
      "invalid_request",
      `trigger.type "${String(type)}" is unknown. Use one of: ${TRIGGER_TYPES.join(", ")}.`,
    );
  }
  const result = triggerSchema.safeParse({ v: 1, ...raw });
  if (result.success) return result.data;
  const problems = result.error.issues
    .map(
      (i) =>
        `trigger${i.path.length ? "." : ""}${i.path.join(".")}: ${i.message}`,
    )
    .join("; ");
  throw new ToolError(
    "invalid_request",
    `Invalid ${type} trigger. ${problems}. Example: ${JSON.stringify(TRIGGER_DOCS[type as TriggerType].example)}`,
  );
}
