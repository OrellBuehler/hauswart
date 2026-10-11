import { describe, expect, it } from "vitest";
import { calendarTriggerSchema, triggerSchema, type Trigger } from "./types";

const valid: [string, Record<string, unknown>][] = [
  [
    "interval",
    {
      v: 1,
      type: "interval",
      every: 2,
      unit: "week",
      anchor: "completion",
      startDate: "2026-01-01",
    },
  ],
  [
    "interval with seasons",
    {
      v: 1,
      type: "interval",
      every: 10,
      unit: "day",
      anchor: "schedule",
      startDate: "2026-01-01",
      seasons: [{ fromMonth: 11, toMonth: 2, every: 3, unit: "day" }],
    },
  ],
  [
    "calendar weekly",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      byWeekday: [1, 4],
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar monthly nth",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byWeekday: [2],
      nth: 2,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar monthly last day",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byMonthDay: -1,
      startDate: "2026-01-01",
      earlyDays: 3,
    },
  ],
  [
    "calendar yearly",
    {
      v: 1,
      type: "calendar",
      freq: "yearly",
      interval: 1,
      byMonth: [3, 9],
      byMonthDay: 15,
      startDate: "2026-01-01",
    },
  ],
  [
    "min_per_period",
    {
      v: 1,
      type: "min_per_period",
      period: "month",
      count: 2,
      remindFromFraction: 0.5,
      startDate: "2026-01-01",
    },
  ],
  [
    "counter_delta",
    {
      v: 1,
      type: "counter_delta",
      entityId: "sensor.x",
      threshold: 500,
      unit: "L",
      autoCompleteOnReset: { minDrop: 100 },
    },
  ],
  [
    "counter_delta with a time limit",
    {
      v: 1,
      type: "counter_delta",
      entityId: "odometer:abc",
      threshold: 15000,
      unit: "km",
      orEvery: { every: 12, unit: "month" },
    },
  ],
  [
    "state_condition",
    {
      v: 1,
      type: "state_condition",
      entityId: "binary_sensor.x",
      op: "eq",
      value: "on",
      forMinutes: 30,
      estimateFrom: { entityId: "sensor.b", target: 20, direction: "down" },
    },
  ],
  [
    "state_condition numeric",
    {
      v: 1,
      type: "state_condition",
      entityId: "sensor.x",
      op: "lt",
      value: 20,
    },
  ],
  [
    "ha_calendar",
    {
      v: 1,
      type: "ha_calendar",
      entityId: "calendar.x",
      summaryMatch: "Paper",
      offsetDays: -1,
      time: "18:00",
    },
  ],
  ["one_off", { v: 1, type: "one_off", date: "2026-10-10" }],
  [
    "kept_bill",
    {
      v: 1,
      type: "kept_bill",
      billId: "b1",
      dueDate: "2026-10-10",
      status: "open",
    },
  ],
  [
    "warranty",
    {
      v: 1,
      type: "warranty",
      until: "2026-10-10",
      extendedUntil: "2027-10-10",
      leadDays: 60,
    },
  ],
];

describe("triggerSchema, valid configs", () => {
  it.each(valid)("%s", (_name, config) => {
    const parsed = triggerSchema.parse(config);
    expect(parsed).toEqual(config);
    expect(parsed.type).toBe(config.type);
  });

  it("narrows by type", () => {
    const t: Trigger = triggerSchema.parse(valid[0][1]);
    if (t.type === "interval") expect(t.every).toBe(2);
    else throw new Error("expected interval");
  });
});

const base = valid[0][1];
const invalid: [string, unknown][] = [
  ["unknown type", { ...base, type: "nope" }],
  ["missing type", { v: 1, every: 1 }],
  [
    "missing version",
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "v")),
  ],
  ["wrong version", { ...base, v: 2 }],
  ["zero interval", { ...base, every: 0 }],
  ["fractional interval", { ...base, every: 1.5 }],
  ["unknown unit", { ...base, unit: "decade" }],
  ["unknown anchor", { ...base, anchor: "random" }],
  ["impossible start date", { ...base, startDate: "2026-02-30" }],
  ["start date in the wrong format", { ...base, startDate: "01.01.2026" }],
  [
    "season month 13",
    {
      ...base,
      seasons: [{ fromMonth: 13, toMonth: 2, every: 1, unit: "day" }],
    },
  ],
  [
    "season month 0",
    { ...base, seasons: [{ fromMonth: 0, toMonth: 2, every: 1, unit: "day" }] },
  ],
  [
    "calendar weekday 8",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      byWeekday: [8],
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar empty weekday list",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      byWeekday: [],
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar day 0",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byMonthDay: 0,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar day 32",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byMonthDay: 32,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar nth 0",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      nth: 0,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar nth and day together",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      nth: 2,
      byMonthDay: 5,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar weekly with a month day",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      byMonthDay: 5,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar weekly with nth",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      nth: 2,
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar monthly weekday without nth",
    {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byWeekday: [2],
      startDate: "2026-01-01",
    },
  ],
  [
    "calendar negative early days",
    {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      startDate: "2026-01-01",
      earlyDays: -1,
    },
  ],
  [
    "min_per_period zero count",
    { v: 1, type: "min_per_period", period: "week", count: 0 },
  ],
  [
    "min_per_period fraction above 1",
    {
      v: 1,
      type: "min_per_period",
      period: "week",
      count: 1,
      remindFromFraction: 1.1,
    },
  ],
  [
    "min_per_period bad period",
    { v: 1, type: "min_per_period", period: "day", count: 1 },
  ],
  [
    "counter zero threshold",
    { v: 1, type: "counter_delta", entityId: "x", threshold: 0 },
  ],
  [
    "counter empty entity",
    { v: 1, type: "counter_delta", entityId: "", threshold: 5 },
  ],
  [
    "counter zero minDrop",
    {
      v: 1,
      type: "counter_delta",
      entityId: "x",
      threshold: 5,
      autoCompleteOnReset: { minDrop: 0 },
    },
  ],
  [
    "counter orEvery zero",
    {
      v: 1,
      type: "counter_delta",
      entityId: "x",
      threshold: 5,
      orEvery: { every: 0, unit: "month" },
    },
  ],
  [
    "counter orEvery bad unit",
    {
      v: 1,
      type: "counter_delta",
      entityId: "x",
      threshold: 5,
      orEvery: { every: 1, unit: "decade" },
    },
  ],
  [
    "counter orEvery without a unit",
    {
      v: 1,
      type: "counter_delta",
      entityId: "x",
      threshold: 5,
      orEvery: { every: 1 },
    },
  ],
  [
    "state gt with a string",
    { v: 1, type: "state_condition", entityId: "x", op: "gt", value: "on" },
  ],
  [
    "state bad op",
    { v: 1, type: "state_condition", entityId: "x", op: "like", value: "on" },
  ],
  [
    "state negative forMinutes",
    {
      v: 1,
      type: "state_condition",
      entityId: "x",
      op: "eq",
      value: "on",
      forMinutes: -1,
    },
  ],
  [
    "state bad direction",
    {
      v: 1,
      type: "state_condition",
      entityId: "x",
      op: "eq",
      value: "on",
      estimateFrom: { entityId: "y", target: 1, direction: "left" },
    },
  ],
  [
    "ha_calendar bad time",
    { v: 1, type: "ha_calendar", entityId: "x", offsetDays: -1, time: "25:00" },
  ],
  [
    "ha_calendar fractional offset",
    { v: 1, type: "ha_calendar", entityId: "x", offsetDays: 0.5 },
  ],
  ["one_off without date", { v: 1, type: "one_off" }],
  [
    "kept_bill unknown status",
    {
      v: 1,
      type: "kept_bill",
      billId: "b",
      dueDate: "2026-10-10",
      status: "late",
    },
  ],
  ["warranty bad date", { v: 1, type: "warranty", until: "soon" }],
];

describe("triggerSchema, invalid configs", () => {
  it.each(invalid)("rejects %s", (_name, config) => {
    expect(triggerSchema.safeParse(config).success).toBe(false);
  });
});

describe("triggerSchema, details", () => {
  it("reports the calendar refinement message", () => {
    const result = calendarTriggerSchema.safeParse({
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      nth: 2,
      byMonthDay: 5,
      startDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "mutually exclusive",
    );
  });

  it("strips unknown keys", () => {
    const parsed = triggerSchema.parse({ ...base, extra: true });
    expect("extra" in parsed).toBe(false);
  });

  it("discriminates on type even when other fields look right", () => {
    expect(triggerSchema.safeParse({ ...base, type: "one_off" }).success).toBe(
      false,
    );
  });
});
