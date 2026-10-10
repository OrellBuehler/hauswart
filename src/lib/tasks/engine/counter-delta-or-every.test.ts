import { describe, expect, it } from "vitest";
import { addDays } from "$lib/dates";
import { at, done, evaluate, skipped, trigger } from "./testing";
import type {
  Completion,
  DueResult,
  EngineState,
  Sample,
  Signal,
  Signals,
} from "./types";

const counter = trigger.counterDelta;
const TODAY = "2026-10-06";
const NOW = at(TODAY);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEY = "odometer:car-1";
const yearly = { every: 12, unit: "month" } as const;
const service = counter({
  entityId: KEY,
  threshold: 15_000,
  unit: "km",
  orEvery: yearly,
});

function reading(
  numeric: number | null,
  seenAgo = HOUR,
  source?: string,
): Signals {
  const signal: Signal = {
    numeric,
    changedAt: NOW - seenAgo,
    seenAt: NOW - seenAgo,
  };
  if (source) signal.source = source;
  return { [KEY]: signal };
}

interface Options {
  trig?: ReturnType<typeof counter>;
  today?: string;
  completions?: Completion[];
  state?: EngineState;
  startedOn?: string;
  graceDays?: number;
  dueSoonDays?: number;
  snoozedUntil?: string;
  signals?: Signals;
  samples?: Sample[];
}

function run(value: number | null, options: Options = {}): DueResult {
  const today = options.today ?? TODAY;
  return evaluate(options.trig ?? service, today, {
    completions: options.completions ?? [],
    state: options.state ?? { counterBaseline: 80_000 },
    signals: options.signals ?? reading(value),
    samples: options.samples ? { [KEY]: options.samples } : {},
    ...(options.startedOn ? { startedOn: options.startedOn } : {}),
    ...(options.graceDays === undefined
      ? {}
      : { graceDays: options.graceDays }),
    ...(options.dueSoonDays === undefined
      ? {}
      : { dueSoonDays: options.dueSoonDays }),
    ...(options.snoozedUntil ? { snoozedUntil: options.snoozedUntil } : {}),
  });
}

type Expected = Pick<DueResult, "status" | "dueDate" | "dueKind">;

describe("counter_delta with orEvery, which half decides", () => {
  it.each<[string, number, Options, Expected]>([
    [
      "the counter gets there first",
      95_000,
      { completions: [done("2026-06-01")] },
      { status: "due", dueDate: "2026-10-06", dueKind: "condition" },
    ],
    [
      "the counter got there first, some days ago",
      95_500,
      {
        completions: [done("2026-06-01")],
        state: { counterBaseline: 80_000, dueSince: at("2026-09-20") },
      },
      { status: "overdue", dueDate: "2026-09-20", dueKind: "condition" },
    ],
    [
      "the time passes first and the counter is far from its threshold",
      82_000,
      { completions: [done("2025-10-01")] },
      { status: "overdue", dueDate: "2026-10-01", dueKind: "exact" },
    ],
    [
      "the time passed long before the counter got there",
      99_000,
      { completions: [done("2025-08-01")] },
      { status: "overdue", dueDate: "2026-08-01", dueKind: "exact" },
    ],
    [
      "the time passes today",
      82_000,
      { completions: [done("2025-10-06")] },
      { status: "due", dueDate: "2026-10-06", dueKind: "exact" },
    ],
    [
      "the time passes within the due soon window",
      82_000,
      { completions: [done("2025-10-09")] },
      { status: "open", dueDate: "2026-10-09", dueKind: "exact" },
    ],
    [
      "the time is far away and the counter shows nothing yet",
      82_000,
      { completions: [done("2026-08-01")] },
      { status: "ok", dueDate: "2027-08-01", dueKind: "exact" },
    ],
    [
      "both on the same day: the counter keeps its own kind",
      95_000,
      { completions: [done("2025-10-06")] },
      { status: "due", dueDate: "2026-10-06", dueKind: "condition" },
    ],
    [
      "a task without a completion counts from the day it started",
      82_000,
      { startedOn: "2026-04-01" },
      { status: "ok", dueDate: "2027-04-01", dueKind: "exact" },
    ],
    [
      "a task that started a year ago is due",
      82_000,
      { startedOn: "2025-10-01" },
      { status: "overdue", dueDate: "2026-10-01", dueKind: "exact" },
    ],
    [
      "without a start date it counts from today",
      82_000,
      {},
      { status: "ok", dueDate: "2027-10-06", dueKind: "exact" },
    ],
    [
      "the last completion beats the start of the task",
      82_000,
      { startedOn: "2020-01-01", completions: [done("2026-09-01")] },
      { status: "ok", dueDate: "2027-09-01", dueKind: "exact" },
    ],
    [
      "the latest of several completions counts",
      82_000,
      {
        completions: [
          done("2024-01-01"),
          done("2026-05-01"),
          done("2025-01-01"),
        ],
      },
      { status: "ok", dueDate: "2027-05-01", dueKind: "exact" },
    ],
    [
      "a skipped completion starts a new period as well",
      82_000,
      { completions: [skipped("2025-09-01")] },
      { status: "overdue", dueDate: "2026-09-01", dueKind: "exact" },
    ],
    [
      "grace days hold back overdue",
      82_000,
      { completions: [done("2025-10-04")], graceDays: 3 },
      { status: "due", dueDate: "2026-10-04", dueKind: "exact" },
    ],
    [
      "grace days run out",
      82_000,
      { completions: [done("2025-10-01")], graceDays: 3 },
      { status: "overdue", dueDate: "2026-10-01", dueKind: "exact" },
    ],
    [
      "the due soon window comes from the task",
      82_000,
      { completions: [done("2025-10-20")], dueSoonDays: 30 },
      { status: "open", dueDate: "2026-10-20", dueKind: "exact" },
    ],
    [
      "snoozed",
      82_000,
      { completions: [done("2025-10-01")], snoozedUntil: "2026-10-20" },
      { status: "snoozed", dueDate: "2026-10-01", dueKind: "exact" },
    ],
  ])("%s", (_name, value, options, expected) => {
    const result = run(value, options);
    expect(result).toMatchObject(expected);
    expect(result.estimate).toBeUndefined();
  });

  it.each<
    [string, { every: number; unit: "day" | "week" | "month" | "year" }, string]
  >([
    ["days", { every: 90, unit: "day" }, "2027-01-13"],
    ["weeks", { every: 26, unit: "week" }, "2027-04-15"],
    ["months", { every: 6, unit: "month" }, "2027-04-15"],
    ["years", { every: 2, unit: "year" }, "2028-10-15"],
  ])("counts in %s", (_name, orEvery, expected) => {
    const result = run(82_000, {
      trig: counter({ entityId: KEY, threshold: 15_000, orEvery }),
      completions: [done("2026-10-15")],
      today: "2026-10-16",
    });
    expect(result.dueDate).toBe(expected);
  });

  it.each<[string, { every: number; unit: "month" | "year" }, string, string]>([
    [
      "the end of a month is clamped",
      { every: 1, unit: "month" },
      "2026-01-31",
      "2026-02-28",
    ],
    [
      "a leap day moves to the end of February",
      { every: 1, unit: "year" },
      "2024-02-29",
      "2025-02-28",
    ],
    ["a plain date", yearly, "2026-03-15", "2027-03-15"],
  ])("%s", (_name, orEvery, completed, expected) => {
    const result = run(82_000, {
      trig: counter({ entityId: KEY, threshold: 15_000, orEvery }),
      completions: [done(completed)],
      today: completed,
    });
    expect(result.dueDate).toBe(expected);
  });

  it("keeps the counter's progress next to the time date", () => {
    const result = run(86_000, { completions: [done("2026-08-01")] });
    expect(result.progress).toEqual({
      current: 6000,
      target: 15_000,
      unit: "km",
    });
  });

  it("names the occurrence after the last completion, whichever half decides", () => {
    const completions = [done("2025-10-01", { id: "last" })];
    expect(run(82_000, { completions }).occurrenceKey).toBe("c:last");
    expect(run(99_000, { completions }).occurrenceKey).toBe("c:last");
    expect(run(82_000).occurrenceKey).toBe("c:init");
  });

  it("a completion settles both halves", () => {
    const before = run(99_000, { completions: [done("2025-01-01")] });
    expect(before.status).toBe("overdue");
    const after = run(99_000, {
      completions: [
        done("2025-01-01"),
        done(TODAY, { id: "serviced", counterValue: 99_000 }),
      ],
    });
    expect(after).toMatchObject({
      status: "ok",
      dueDate: "2027-10-06",
      dueKind: "exact",
      occurrenceKey: "c:serviced",
    });
    expect(after.progress?.current).toBe(0);
  });

  it("a trigger without orEvery behaves as before", () => {
    const plain = counter({ entityId: KEY, threshold: 15_000, unit: "km" });
    const result = run(82_000, {
      trig: plain,
      completions: [done("2025-01-01")],
    });
    expect(result).toMatchObject({
      status: "ok",
      dueDate: null,
      dueKind: "none",
    });
    expect(run(null, { trig: plain }).status).toBe("unknown");
  });
});

describe("counter_delta with orEvery, without a usable counter", () => {
  it.each<[string, Options, Expected, string]>([
    [
      "no reading at all",
      { signals: {}, startedOn: "2026-04-01" },
      { status: "ok", dueDate: "2027-04-01", dueKind: "exact" },
      "signal_missing",
    ],
    [
      "no reading and the time is up",
      { signals: {}, completions: [done("2025-01-01")] },
      { status: "overdue", dueDate: "2026-01-01", dueKind: "exact" },
      "signal_missing",
    ],
    [
      "a reading without a number",
      {
        signals: {
          [KEY]: { text: "n/a", changedAt: NOW, seenAt: NOW },
        },
      },
      { status: "ok", dueDate: "2027-10-06", dueKind: "exact" },
      "signal_missing",
    ],
    [
      "a stale home automation counter",
      { signals: reading(90_000, 3 * DAY, "ha"), startedOn: "2026-04-01" },
      { status: "ok", dueDate: "2027-04-01", dueKind: "exact" },
      "signal_stale",
    ],
    [
      "a stale counter and the time is up",
      {
        signals: reading(99_000, 3 * DAY, "ha"),
        completions: [done("2025-09-01")],
      },
      { status: "overdue", dueDate: "2026-09-01", dueKind: "exact" },
      "signal_stale",
    ],
    [
      "a stale counter and the time is nearly up",
      {
        signals: reading(99_000, 3 * DAY, "ha"),
        completions: [done("2025-10-10")],
      },
      { status: "open", dueDate: "2026-10-10", dueKind: "exact" },
      "signal_stale",
    ],
    [
      "a counter without a starting value",
      { state: {}, startedOn: "2026-04-01" },
      { status: "ok", dueDate: "2027-04-01", dueKind: "exact" },
      "baseline_missing",
    ],
  ])("%s: the time half still works", (_name, options, expected, reason) => {
    const result = run(90_000, options);
    expect(result).toMatchObject(expected);
    expect(result.status).not.toBe("unknown");
    expect(result.reasons).toEqual([reason]);
    expect(result.progress).toBeUndefined();
  });

  it.each([
    ["no reading", { signals: {} }, "signal_missing"],
    ["a stale reading", { signals: reading(90_000, 3 * DAY) }, "signal_stale"],
    ["no starting value", { state: {} }, "baseline_missing"],
  ] as [string, Options, string][])(
    "%s without orEvery is still unknown",
    (_name, options, reason) => {
      const plain = counter({ entityId: KEY, threshold: 15_000 });
      const result = run(90_000, { trig: plain, ...options });
      expect(result).toMatchObject({
        status: "unknown",
        dueDate: null,
        dueKind: "none",
        reasons: [reason],
      });
    },
  );

  it("a stale counter never reports the counter half as due", () => {
    const result = run(99_000, {
      signals: reading(99_000, 3 * DAY, "ha"),
      completions: [done("2026-08-01")],
    });
    expect(result.status).toBe("ok");
    expect(result.dueDate).toBe("2027-08-01");
  });

  it("a manual reading is not stale however old it is", () => {
    const result = run(96_000, {
      signals: reading(96_000, 200 * DAY, "manual"),
      completions: [done("2026-08-01")],
    });
    expect(result).toMatchObject({
      status: "due",
      dueDate: "2026-10-06",
      dueKind: "condition",
    });
    expect(result.reasons).toEqual([]);
  });

  it("a manual reading counts when the time half has no say", () => {
    const plain = counter({ entityId: KEY, threshold: 15_000 });
    const result = run(90_000, {
      trig: plain,
      signals: reading(90_000, 90 * DAY, "manual"),
    });
    expect(result.status).toBe("ok");
    expect(result.progress?.current).toBe(10_000);
  });
});

describe("counter_delta with orEvery, estimates", () => {
  const series = (
    from: number,
    to: number,
    f: (offset: number) => number,
  ): Sample[] => {
    const out: Sample[] = [];
    for (let o = from; o <= to; o += 1) {
      out.push({ at: at(addDays(TODAY, o)), value: f(o) });
    }
    return out;
  };
  // 100 km per day: from 80,000 to 81,900 over the last 19 days.
  const fast = series(-19, 0, (o) => 80_000 + 100 * (o + 19));
  const fastCounter = (orEvery = yearly) =>
    counter({ entityId: KEY, threshold: 2_000, orEvery });

  it("the estimate is shown when the counter is expected to get there first", () => {
    const result = run(81_900, {
      trig: fastCounter(),
      samples: fast,
      completions: [done("2026-08-01")],
    });
    expect(result).toMatchObject({
      status: "ok",
      dueDate: null,
      dueKind: "estimated",
      estimate: { date: "2026-10-07", confidence: "medium" },
    });
    expect(result.progress).toEqual({ current: 1900, target: 2000 });
  });

  it("the time limit stays in charge of the status", () => {
    const result = run(81_900, {
      trig: fastCounter(),
      samples: fast,
      completions: [done("2025-10-11")],
    });
    expect(result).toMatchObject({
      status: "open",
      dueDate: null,
      dueKind: "estimated",
      estimate: { date: "2026-10-07" },
    });
  });

  it("the time limit is shown when it comes before the estimate", () => {
    const result = run(81_900, {
      trig: fastCounter(),
      samples: fast,
      completions: [done("2025-10-06")],
      state: { counterBaseline: 80_000 },
    });
    expect(result).toMatchObject({
      status: "due",
      dueDate: "2026-10-06",
      dueKind: "exact",
    });
    expect(result.estimate).toBeUndefined();
  });

  it("the time limit wins a tie with the estimate", () => {
    const result = run(81_900, {
      trig: fastCounter(),
      samples: fast,
      completions: [done("2025-10-07")],
    });
    expect(result).toMatchObject({ dueDate: "2026-10-07", dueKind: "exact" });
    expect(result.estimate).toBeUndefined();
  });

  it("the date is the time limit when the estimate lies beyond it", () => {
    const slow = series(-19, 0, (o) => 80_000 + 5 * (o + 19));
    const result = run(80_095, {
      trig: counter({ entityId: KEY, threshold: 15_000, orEvery: yearly }),
      samples: slow,
      completions: [done("2026-03-01")],
    });
    expect(result).toMatchObject({
      status: "ok",
      dueDate: "2027-03-01",
      dueKind: "exact",
    });
    expect(result.estimate).toBeUndefined();
  });

  it("an estimate from the completion history is marked as such", () => {
    const result = run(80_100, {
      trig: counter({ entityId: KEY, threshold: 15_000, orEvery: yearly }),
      completions: [done("2026-08-01"), done("2026-09-15")],
    });
    expect(result).toMatchObject({
      dueDate: null,
      dueKind: "estimated",
      estimate: { date: "2026-10-30", confidence: "low" },
    });
    expect(result.reasons).toContain("estimate_from_history");
  });

  it("an estimate from history that loses to the time limit is not reported", () => {
    const result = run(80_100, {
      trig: counter({
        entityId: KEY,
        threshold: 15_000,
        orEvery: { every: 1, unit: "month" },
      }),
      completions: [done("2026-05-01"), done("2026-09-20")],
    });
    expect(result).toMatchObject({ dueDate: "2026-10-20", dueKind: "exact" });
    expect(result.reasons).not.toContain("estimate_from_history");
  });

  it("without orEvery the estimate is the whole story, as before", () => {
    const result = run(81_900, {
      trig: counter({ entityId: KEY, threshold: 2_000 }),
      samples: fast,
    });
    expect(result).toMatchObject({
      status: "ok",
      dueDate: null,
      dueKind: "estimated",
    });
  });

  describe("sparse manual readings", () => {
    // Three readings in four months: 6,000 km in 120 days, 50 km a day.
    const sparse: Sample[] = [
      { at: at(addDays(TODAY, -120)), value: 80_000 },
      { at: at(addDays(TODAY, -60)), value: 83_000 },
      { at: at(addDays(TODAY, -30)), value: 84_500 },
      { at: at(addDays(TODAY, -1)), value: 85_950 },
    ];
    const target = counter({ entityId: KEY, threshold: 10_000 });

    it("looks back as far as a year", () => {
      const old = sparse.slice(0, 2);
      const result = run(83_000, {
        trig: target,
        samples: old,
        signals: reading(83_000, 60 * DAY, "manual"),
      });
      expect(result.dueKind).toBe("estimated");
      expect(result.estimate?.confidence).toBe("medium");
    });

    it("keeps the usual windows for an automated counter", () => {
      const old = sparse.slice(0, 2);
      const result = run(83_000, {
        trig: target,
        samples: old,
        signals: reading(83_000, HOUR, "ha"),
      });
      expect(result.dueKind).toBe("none");
    });

    it("prefers the nearer window when it has enough data", () => {
      const result = run(85_950, {
        trig: target,
        samples: sparse,
        signals: reading(85_950, HOUR, "manual"),
      });
      expect(result.estimate).toBeDefined();
      // The 90 days leave out the oldest reading: about 50 km a day, 4,050 km to go, counted from
      // the newest reading, which is a day old.
      expect(result.estimate?.date).toBe("2026-12-25");
    });
  });
});
