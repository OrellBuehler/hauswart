import { describe, expect, it } from "vitest";
import { addDays } from "$lib/dates";
import { detectCounterReset } from "./counter-delta";
import { at, done, evaluate, skipped, trigger } from "./testing";
import type { Completion, EngineState, Sample, Signals } from "./types";

const counter = trigger.counterDelta;
const TODAY = "2026-10-06";
const NOW = at(TODAY);
const HOUR = 3_600_000;
const ENTITY = "sensor.filter_litres";
const t5 = counter({ entityId: ENTITY, threshold: 5 });

function signals(numeric: number | null, seenAgo = HOUR): Signals {
  return {
    [ENTITY]: { numeric, changedAt: NOW - seenAgo, seenAt: NOW - seenAgo },
  };
}

function run(
  value: number | null,
  opts: {
    completions?: Completion[];
    state?: EngineState;
    graceDays?: number;
    today?: string;
    now?: number;
    samples?: Record<string, Sample[]>;
    trig?: ReturnType<typeof counter>;
  } = {},
) {
  const now = opts.now ?? NOW;
  return evaluate(opts.trig ?? t5, opts.today ?? TODAY, {
    completions: opts.completions ?? [],
    state: opts.state ?? { counterBaseline: 0 },
    graceDays: opts.graceDays ?? 0,
    now,
    samples: opts.samples ?? {},
    signals: {
      [ENTITY]: { numeric: value, changedAt: now - HOUR, seenAt: now - HOUR },
    },
  });
}

describe("counter_delta, signal handling", () => {
  it("unknown without a signal entry", () => {
    const result = evaluate(t5, TODAY, { state: { counterBaseline: 0 } });
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(["signal_missing"]);
    expect(result.dueDate).toBeNull();
    expect(result.dueKind).toBe("none");
    expect(result.occurrenceKey).toBe("c:init");
  });

  it.each([
    ["null numeric", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("unknown for %s", (_name, value) => {
    const result = run(value);
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(["signal_missing"]);
  });

  it("a text-only signal is not numeric", () => {
    const result = evaluate(t5, TODAY, {
      state: { counterBaseline: 0 },
      signals: {
        [ENTITY]: { text: "unavailable", changedAt: NOW, seenAt: NOW },
      },
    });
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(["signal_missing"]);
  });

  it.each([
    ["seen 1 hour ago", HOUR, "ok"],
    ["seen exactly 24 hours ago is still fresh", 24 * HOUR, "ok"],
    ["seen 24 hours and 1 ms ago is stale", 24 * HOUR + 1, "unknown"],
    ["seen 3 days ago is stale", 72 * HOUR, "unknown"],
  ])("%s", (_name, seenAgo, status) => {
    const result = evaluate(t5, TODAY, {
      state: { counterBaseline: 0 },
      signals: signals(2, seenAgo),
    });
    expect(result.status).toBe(status);
    if (status === "unknown") {
      expect(result.reasons).toEqual(["signal_stale"]);
    }
  });

  it("a stale signal never reports due", () => {
    const result = evaluate(t5, TODAY, {
      state: { counterBaseline: 0 },
      signals: signals(500, 48 * HOUR),
    });
    expect(result.status).toBe("unknown");
  });

  it("unknown without any baseline", () => {
    const result = evaluate(t5, TODAY, { signals: signals(3) });
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(["baseline_missing"]);
  });
});

describe("counter_delta, delta and threshold", () => {
  it.each([
    ["no consumption", 0, 0, "ok", 0],
    ["below the threshold", 0, 4, "ok", 4],
    ["exactly the threshold", 0, 5, "due", 5],
    ["above the threshold (cloud jump 4 -> 6)", 0, 6, "due", 6],
    ["offset baseline, below", 100, 104, "ok", 4],
    ["offset baseline, exactly", 100, 105, "due", 5],
    ["fractional values", 10.5, 15.5, "due", 5],
    ["fractional values just below", 10.5, 15.4, "ok", 4.9],
  ])("%s", (_name, baseline, current, status, delta) => {
    const result = run(current, { state: { counterBaseline: baseline } });
    expect(result.status).toBe(status);
    expect(result.progress?.target).toBe(5);
    expect(result.progress?.current).toBeCloseTo(delta);
    if (status === "due") {
      expect(result.dueKind).toBe("condition");
      expect(result.dueDate).toBe(TODAY);
    } else {
      expect(result.dueDate).toBeNull();
    }
  });

  it("a poll gap that skips over the threshold still triggers", () => {
    expect(run(4).status).toBe("ok");
    expect(run(6).status).toBe("due");
  });

  it("copies the unit into the progress", () => {
    const result = run(3, {
      trig: counter({ entityId: ENTITY, threshold: 5, unit: "L" }),
    });
    expect(result.progress).toEqual({ current: 3, target: 5, unit: "L" });
  });

  it("omits the unit when there is none", () => {
    expect(run(3).progress).toEqual({ current: 3, target: 5 });
  });
});

describe("counter_delta, baseline from completions", () => {
  it("uses the counterValue of the latest completion over the state baseline", () => {
    const completions = [done("2026-09-01", { counterValue: 20 })];
    expect(run(24, { completions, state: { counterBaseline: 0 } }).status).toBe(
      "ok",
    );
    expect(run(25, { completions, state: { counterBaseline: 0 } }).status).toBe(
      "due",
    );
  });

  it("the latest completion wins", () => {
    const completions = [
      done("2026-09-20", { counterValue: 40 }),
      done("2026-08-01", { counterValue: 10 }),
    ];
    expect(run(43, { completions }).progress?.current).toBe(3);
  });

  it("completions without a counterValue are ignored for the baseline", () => {
    const completions = [
      done("2026-09-20", { counterValue: 40 }),
      done("2026-10-01", { counterValue: null }),
      done("2026-10-02"),
    ];
    const result = run(43, { completions });
    expect(result.progress?.current).toBe(3);
    expect(result.occurrenceKey).toBe("c:c-2026-10-02-10:00");
  });

  it("a skipped completion that carries a counterValue resets the baseline", () => {
    const completions = [
      done("2026-08-01", { counterValue: 10 }),
      skipped("2026-09-20", { counterValue: 30 }),
    ];
    expect(run(32, { completions }).progress?.current).toBe(2);
  });

  it("falls back to the state baseline when no completion has a counterValue", () => {
    const completions = [done("2026-09-20")];
    expect(
      run(8, { completions, state: { counterBaseline: 4 } }).progress?.current,
    ).toBe(4);
  });

  it("completing resets the due state", () => {
    const before = run(25, { state: { counterBaseline: 0 } });
    expect(before.status).toBe("due");
    const after = run(25, {
      completions: [done(TODAY, { counterValue: 25, id: "c-new" })],
    });
    expect(after.status).toBe("ok");
    expect(after.occurrenceKey).toBe("c:c-new");
    expect(after.occurrenceKey).not.toBe(before.occurrenceKey);
  });

  it("occurrenceKey is the latest completion id (not the latest with a counter)", () => {
    const completions = [
      done("2026-09-01", { id: "a", counterValue: 1 }),
      done("2026-09-02", { id: "b" }),
    ];
    expect(run(2, { completions }).occurrenceKey).toBe("c:b");
    expect(run(2).occurrenceKey).toBe("c:init");
  });
});

describe("counter_delta, counter reset", () => {
  it.each([
    ["reset below the threshold", 100, 3, "ok", 3],
    ["reset back to zero", 100, 0, "ok", 0],
    ["reset and already above the threshold", 100, 8, "due", 8],
    ["reset to exactly the threshold", 100, 5, "due", 5],
  ])("%s", (_name, baseline, current, status, delta) => {
    const result = run(current, { state: { counterBaseline: baseline } });
    expect(result.status).toBe(status);
    expect(result.progress?.current).toBe(delta);
    expect(result.reasons).toContain("counter_reset");
  });

  it("a baseline from a completion is treated the same", () => {
    const result = run(2, {
      completions: [done("2026-09-01", { counterValue: 50 })],
    });
    expect(result.reasons).toContain("counter_reset");
    expect(result.progress?.current).toBe(2);
  });

  it("no reset reason when the value merely stays equal", () => {
    expect(run(0).reasons).toEqual([]);
  });
});

describe("counter_delta, due date and overdue", () => {
  it("the due date is the local date of now when dueSince is unset", () => {
    const now = Date.parse("2026-10-06T22:30:00Z");
    const result = run(9, { today: "2026-10-07", now });
    expect(result.dueDate).toBe("2026-10-07");
    expect(result.status).toBe("due");
  });

  it("dueSince decides the date in the household zone", () => {
    const dueSince = Date.parse("2026-09-30T22:30:00Z");
    const result = run(9, { state: { counterBaseline: 0, dueSince } });
    expect(result.dueDate).toBe("2026-10-01");
  });

  it.each([
    ["no grace", 0, "overdue"],
    ["grace 4 days: 5 days late is overdue", 4, "overdue"],
    ["grace 5 days still due", 5, "due"],
    ["grace 10 days still due", 10, "due"],
  ])("overdue with dueSince five days ago: %s", (_name, graceDays, status) => {
    const result = run(9, {
      state: { counterBaseline: 0, dueSince: at("2026-10-01") },
      graceDays,
    });
    expect(result.dueDate).toBe("2026-10-01");
    expect(result.status).toBe(status);
  });
});

describe("counter_delta, estimates", () => {
  const series = (
    from: number,
    to: number,
    f: (o: number) => number,
  ): Sample[] => {
    const out: Sample[] = [];
    for (let o = from; o <= to; o += 1)
      out.push({ at: at(addDays(TODAY, o)), value: f(o) });
    return out;
  };
  const t100 = counter({ entityId: ENTITY, threshold: 100 });

  it("estimates the day the threshold is crossed", () => {
    const samples = { [ENTITY]: series(-19, 0, (o) => 2 * (o + 19)) };
    const result = run(38, { trig: t100, samples });
    expect(result.status).toBe("ok");
    expect(result.dueKind).toBe("estimated");
    expect(result.dueDate).toBeNull();
    expect(result.estimate).toEqual({
      date: "2026-11-06",
      confidence: "medium",
    });
    expect(result.progress).toEqual({ current: 38, target: 100 });
  });

  it("uses the baseline of the last completion for the target", () => {
    const samples = { [ENTITY]: series(-19, 0, (o) => 1000 + 2 * (o + 19)) };
    const result = run(1038, {
      trig: t100,
      samples,
      completions: [done("2026-08-01", { counterValue: 1000 })],
    });
    expect(result.estimate?.date).toBe("2026-11-06");
  });

  it("only looks at samples after the last reset", () => {
    const samples = {
      [ENTITY]: [
        ...series(-30, -11, (o) => 500 + o),
        ...series(-10, 0, (o) => o + 10),
      ],
    };
    const result = run(10, {
      trig: counter({ entityId: ENTITY, threshold: 30 }),
      samples,
      state: { counterBaseline: 480 },
    });
    expect(result.reasons).toContain("counter_reset");
    expect(result.estimate).toEqual({ date: "2026-10-26", confidence: "low" });
  });

  it("falls back to the completion history without samples", () => {
    const completions = [done("2026-07-01"), done("2026-09-01")];
    const result = run(3, { completions, state: { counterBaseline: 0 } });
    expect(result.dueKind).toBe("estimated");
    expect(result.estimate).toEqual({ date: "2026-11-02", confidence: "low" });
    expect(result.reasons).toContain("estimate_from_history");
  });

  it("a history estimate in the past is moved to tomorrow", () => {
    const completions = [done("2026-06-01"), done("2026-08-01")];
    const result = run(3, { completions, state: { counterBaseline: 0 } });
    expect(result.estimate?.date).toBe("2026-10-07");
  });

  it("no estimate without samples and with a single completion", () => {
    const result = run(3, {
      completions: [done("2026-09-01", { counterValue: 0 })],
    });
    expect(result.dueKind).toBe("none");
    expect(result.estimate).toBeUndefined();
    expect(result.dueDate).toBeNull();
  });

  it("flat samples give no sample estimate", () => {
    const samples = { [ENTITY]: series(-19, 0, () => 3) };
    const result = run(3, { samples });
    expect(result.dueKind).toBe("none");
  });

  it("a due counter has no estimate", () => {
    const samples = { [ENTITY]: series(-19, 0, (o) => o + 19) };
    expect(run(19, { samples }).estimate).toBeUndefined();
  });
});

describe("detectCounterReset", () => {
  it.each([
    [100, 3, 10, true],
    [100, 90, 10, true],
    [100, 91, 10, false],
    [100, 100, 10, false],
    [100, 120, 10, false],
    [0, 0, 1, false],
    [5, 0, 5, true],
    [5, 1, 5, false],
    [10.5, 0.2, 10, true],
    [Number.NaN, 0, 1, false],
    [10, Number.NaN, 1, false],
    [Number.POSITIVE_INFINITY, 0, 1, false],
  ])(
    "detectCounterReset(%d, %d, minDrop %d) = %s",
    (prev, next, minDrop, expected) => {
      expect(detectCounterReset(prev, next, minDrop)).toBe(expected);
    },
  );
});
