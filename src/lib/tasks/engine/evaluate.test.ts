import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateTask } from "./evaluate";
import { haCalendarKey } from "./ha-calendar";
import { at, done, evaluate, TZ, trigger } from "./testing";
import type { Completion, EvaluateInput, Trigger } from "./types";

const TODAY = "2026-10-06";
const NOW = at(TODAY);

const cases: [string, Trigger, Partial<EvaluateInput>, string][] = [
  [
    "interval",
    trigger.interval({
      every: 2,
      unit: "week",
      anchor: "completion",
      startDate: "2026-01-01",
    }),
    { completions: [done("2026-10-01")] },
    "2026-10-15",
  ],
  [
    "calendar",
    trigger.calendar({
      freq: "weekly",
      interval: 1,
      byWeekday: [1],
      startDate: "2026-10-05",
    }),
    { completions: [done("2026-10-05")] },
    "2026-10-12",
  ],
  [
    "min_per_period",
    trigger.minPerPeriod({ period: "week", count: 1 }),
    {},
    "2026-10-11",
  ],
  [
    "counter_delta",
    trigger.counterDelta({ entityId: "sensor.c", threshold: 5 }),
    {
      state: { counterBaseline: 0 },
      signals: { "sensor.c": { numeric: 6, changedAt: NOW, seenAt: NOW } },
    },
    "2026-10-06",
  ],
  [
    "state_condition",
    trigger.stateCondition({
      entityId: "binary_sensor.s",
      op: "eq",
      value: "on",
    }),
    {
      signals: {
        "binary_sensor.s": { text: "on", changedAt: NOW, seenAt: NOW },
      },
    },
    "2026-10-06",
  ],
  [
    "ha_calendar",
    trigger.haCalendar({ entityId: "calendar.w", offsetDays: -1 }),
    { externalDates: { "calendar.w#": ["2026-10-14"] } },
    "2026-10-13",
  ],
  ["one_off", trigger.oneOff({ date: "2026-10-09" }), {}, "2026-10-09"],
  [
    "kept_bill",
    trigger.keptBill({ billId: "b1", dueDate: "2026-10-12", status: "open" }),
    {},
    "2026-10-12",
  ],
  [
    "warranty",
    trigger.warranty({ until: "2026-11-01", extendedUntil: "2026-12-01" }),
    {},
    "2026-12-01",
  ],
];

describe("evaluateTask dispatch", () => {
  it.each(cases)("%s", (_name, t, extra, dueDate) => {
    const result = evaluate(t, TODAY, extra);
    expect(result.dueDate).toBe(dueDate);
    expect(result.occurrenceKey).toEqual(expect.any(String));
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it("every trigger type is covered", () => {
    expect(new Set(cases.map(([, t]) => t.type)).size).toBe(9);
  });
});

describe("evaluateTask, snooze", () => {
  const t = trigger.oneOff({ date: "2026-10-01" });

  it.each([
    ["snoozed until tomorrow", "2026-10-07", "snoozed"],
    ["snoozed far ahead", "2027-01-01", "snoozed"],
    ["snooze ending today is over", "2026-10-06", "overdue"],
    ["snooze in the past", "2026-10-05", "overdue"],
    ["no snooze", null, "overdue"],
    ["empty snooze", "", "overdue"],
  ])("%s", (_name, snoozedUntil, status) => {
    const result = evaluate(t, TODAY, { snoozedUntil });
    expect(result.status).toBe(status);
    expect(result.dueDate).toBe("2026-10-01");
    expect(result.reasons.includes("snoozed")).toBe(status === "snoozed");
  });

  it.each([
    ["open", trigger.oneOff({ date: "2026-10-10" })],
    ["due", trigger.oneOff({ date: TODAY })],
    ["overdue", trigger.oneOff({ date: "2026-10-01" })],
  ])("snoozes a task that is %s", (status, tr) => {
    expect(evaluate(tr, TODAY).status).toBe(status);
    expect(evaluate(tr, TODAY, { snoozedUntil: "2026-10-08" }).status).toBe(
      "snoozed",
    );
  });

  it("does not snooze ok or unknown tasks", () => {
    const far = trigger.oneOff({ date: "2027-01-01" });
    expect(evaluate(far, TODAY, { snoozedUntil: "2026-10-08" }).status).toBe(
      "ok",
    );
    const unknown = trigger.haCalendar({
      entityId: "calendar.w",
      offsetDays: 0,
    });
    expect(
      evaluate(unknown, TODAY, { snoozedUntil: "2026-10-08" }).status,
    ).toBe("unknown");
  });

  it("does not snooze a completed task", () => {
    const result = evaluate(t, TODAY, {
      snoozedUntil: "2026-10-08",
      completions: [done("2026-10-05")],
    });
    expect(result.status).toBe("ok");
  });
});

describe("evaluateTask, defaults and parameters", () => {
  const t = trigger.oneOff({ date: "2026-10-13" });

  it("dueSoonDays defaults to 7", () => {
    expect(evaluate(t, "2026-10-06").status).toBe("open");
    expect(evaluate(t, "2026-10-05").status).toBe("ok");
  });

  it("graceDays defaults to 0", () => {
    expect(evaluate(t, "2026-10-14").status).toBe("overdue");
  });

  it("explicit values override", () => {
    expect(evaluate(t, "2026-10-05", { dueSoonDays: 8 }).status).toBe("open");
    expect(evaluate(t, "2026-10-14", { graceDays: 1 }).status).toBe("due");
  });

  it("passes the zone through to local date conversion", () => {
    const counter = trigger.counterDelta({
      entityId: "sensor.c",
      threshold: 1,
    });
    const now = Date.parse("2026-10-06T22:30:00Z");
    const run = (tz: string, today: string) =>
      evaluateTask({
        trigger: counter,
        completions: [],
        state: { counterBaseline: 0 },
        signals: { "sensor.c": { numeric: 5, changedAt: now, seenAt: now } },
        today,
        now,
        tz,
      }).dueDate;
    expect(run(TZ, "2026-10-07")).toBe("2026-10-07");
    expect(run("UTC", "2026-10-06")).toBe("2026-10-06");
    expect(run("America/Los_Angeles", "2026-10-06")).toBe("2026-10-06");
  });
});

describe("evaluateTask, purity", () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) deepFreeze(v);
      Object.freeze(value);
    }
    return value;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(cases)(
    "%s does not mutate its inputs and is deterministic",
    (_name, t, extra) => {
      const completions: Completion[] = [
        done("2026-09-01"),
        done("2026-09-15"),
      ];
      const input: EvaluateInput = deepFreeze({
        trigger: t,
        completions,
        today: TODAY,
        now: NOW,
        tz: TZ,
        snoozedUntil: "2026-10-07",
        ...extra,
      });
      const first = evaluateTask(input);
      const second = evaluateTask(input);
      expect(second).toEqual(first);
    },
  );

  it.each(cases)("%s never reads the clock", (_name, t, extra) => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock read");
    });
    expect(() =>
      evaluateTask({
        trigger: t,
        completions: [],
        today: TODAY,
        now: NOW,
        tz: TZ,
        ...extra,
      }),
    ).not.toThrow();
  });

  it("returns the same result no matter when the test runs", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2031-05-05T00:00:00Z"));
      const a = evaluate(cases[0][1], TODAY, cases[0][2]);
      vi.setSystemTime(new Date("2019-01-01T00:00:00Z"));
      const b = evaluate(cases[0][1], TODAY, cases[0][2]);
      expect(a).toEqual(b);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("evaluateTask, a realistic week", () => {
  it("walks a completion anchored task through its states", () => {
    const t = trigger.interval({
      every: 14,
      unit: "day",
      anchor: "completion",
      startDate: "2026-09-01",
    });
    const completions = [done("2026-09-22")];
    const statuses = [
      "2026-09-27",
      "2026-09-29",
      "2026-10-06",
      "2026-10-07",
    ].map((today) => evaluate(t, today, { completions }).status);
    expect(statuses).toEqual(["ok", "open", "due", "overdue"]);
  });

  it("uses the ha_calendar key helper consistently", () => {
    const t = trigger.haCalendar({
      entityId: "calendar.w",
      offsetDays: -1,
      summaryMatch: "Bio",
    });
    const result = evaluate(t, TODAY, {
      externalDates: { [haCalendarKey(t)]: ["2026-10-07"] },
    });
    expect(result.dueDate).toBe("2026-10-06");
    expect(result.status).toBe("due");
  });
});
