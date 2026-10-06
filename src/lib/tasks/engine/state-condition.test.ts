import { describe, expect, it } from "vitest";
import { addDays } from "$lib/dates";
import { evalPredicate } from "./state-condition";
import { at, done, evaluate, skipped, trigger } from "./testing";
import type { Completion, EngineState, Sample, Signal } from "./types";

const cond = trigger.stateCondition;
const TODAY = "2026-10-06";
const NOW = at(TODAY);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ENTITY = "binary_sensor.window_open";

function sig(partial: Partial<Signal>): Signal {
  return { changedAt: NOW - 2 * HOUR, seenAt: NOW - 5 * MIN, ...partial };
}

function run(
  t: ReturnType<typeof cond>,
  signal: Signal | undefined,
  opts: {
    completions?: Completion[];
    state?: EngineState;
    graceDays?: number;
    samples?: Record<string, Sample[]>;
    today?: string;
  } = {},
) {
  return evaluate(t, opts.today ?? TODAY, {
    now: NOW,
    completions: opts.completions ?? [],
    state: opts.state ?? {},
    graceDays: opts.graceDays ?? 0,
    samples: opts.samples ?? {},
    signals: signal ? { [ENTITY]: signal } : {},
  });
}

const isOn = cond({ entityId: ENTITY, op: "eq", value: "on" });

describe("evalPredicate", () => {
  it.each([
    ["text eq", { text: "on" }, "eq", "on", true],
    ["text eq mismatch", { text: "off" }, "eq", "on", false],
    ["text eq ignores case", { text: "ON" }, "eq", "on", true],
    ["text eq trims", { text: " on " }, "eq", "on", true],
    ["config value case is ignored too", { text: "on" }, "eq", " ON ", true],
    ["text ne", { text: "off" }, "ne", "on", true],
    ["text ne mismatch", { text: "on" }, "ne", "on", false],
    ["numeric signal against a string value", { numeric: 1 }, "eq", "1", true],
    ["numeric gt", { numeric: 3 }, "gt", 2, true],
    ["numeric gt equal", { numeric: 3 }, "gt", 3, false],
    ["numeric gte equal", { numeric: 3 }, "gte", 3, true],
    ["numeric lt", { numeric: 2 }, "lt", 3, true],
    ["numeric lt equal", { numeric: 3 }, "lt", 3, false],
    ["numeric lte equal", { numeric: 3 }, "lte", 3, true],
    ["numeric eq", { numeric: 5 }, "eq", 5, true],
    ["numeric eq mismatch", { numeric: 5 }, "eq", 6, false],
    ["numeric ne", { numeric: 5 }, "ne", 6, true],
    ["numeric ne equal", { numeric: 5 }, "ne", 5, false],
    ["numeric zero", { numeric: 0 }, "lt", 1, true],
    ["negative numbers", { numeric: -5 }, "lt", -4, true],
    ["numeric text is parsed", { text: "5.5" }, "gt", 5, true],
    ["numeric text equal", { text: "5" }, "eq", 5, true],
    [
      "numeric prefers the numeric field",
      { numeric: 1, text: "9" },
      "lt",
      5,
      true,
    ],
    [
      "non numeric text against a number is false",
      { text: "abc" },
      "gt",
      5,
      false,
    ],
    [
      "non numeric text with ne against a number is false",
      { text: "on" },
      "ne",
      5,
      false,
    ],
    [
      "string value with gt is parsed as number",
      { numeric: 5 },
      "gt",
      "3",
      true,
    ],
    ["garbage string with gt is false", { numeric: 5 }, "gt", "abc", false],
    ["unavailable", { text: "unavailable" }, "eq", "on", "unavailable"],
    [
      "unavailable beats ne",
      { text: "unavailable" },
      "ne",
      "on",
      "unavailable",
    ],
    ["unknown", { text: "unknown" }, "eq", "on", "unavailable"],
    [
      "unavailable ignoring case",
      { text: "Unavailable" },
      "lt",
      5,
      "unavailable",
    ],
    ["neither numeric nor text", {}, "eq", "on", false],
  ] as const)("%s", (_name, partial, op, value, expected) => {
    expect(evalPredicate(sig({ ...partial }), op, value)).toBe(expected);
  });
});

describe("state_condition, activity", () => {
  it("unknown without a signal", () => {
    const result = run(isOn, undefined);
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(["signal_missing"]);
    expect(result.occurrenceKey).toBe("s:none");
  });

  it("unknown for an empty signal", () => {
    expect(run(isOn, sig({ numeric: null, text: null })).status).toBe(
      "unknown",
    );
    expect(run(isOn, sig({ numeric: null, text: "" })).reasons).toEqual([
      "signal_missing",
    ]);
  });

  it.each([
    ["fresh", 23 * HOUR, "due"],
    ["exactly 24 hours", 24 * HOUR, "due"],
    ["over 24 hours", 24 * HOUR + 1, "unknown"],
  ])("staleness: %s", (_name, ago, status) => {
    const result = run(
      isOn,
      sig({ text: "on", seenAt: NOW - ago, changedAt: NOW - HOUR }),
    );
    expect(result.status).toBe(status);
    if (status === "unknown") expect(result.reasons).toEqual(["signal_stale"]);
  });

  it("inactive predicate is ok without a date", () => {
    const result = run(isOn, sig({ text: "off" }));
    expect(result.status).toBe("ok");
    expect(result.dueDate).toBeNull();
    expect(result.dueKind).toBe("none");
    expect(result.occurrenceKey).toBe("s:none");
    expect(result.reasons).toEqual([]);
  });

  it("active predicate is due on the date of changedAt", () => {
    const changedAt = NOW - 2 * HOUR;
    const result = run(isOn, sig({ text: "on", changedAt }));
    expect(result.status).toBe("due");
    expect(result.dueDate).toBe(TODAY);
    expect(result.dueKind).toBe("condition");
    expect(result.occurrenceKey).toBe(`s:${changedAt}`);
    expect(result.reasons).toEqual(["condition_active"]);
  });

  it.each([
    ["no grace", 0, "overdue"],
    ["grace 2", 2, "overdue"],
    ["grace 3", 3, "due"],
  ])("active since three days ago: %s", (_name, graceDays, status) => {
    const result = run(isOn, sig({ text: "on", changedAt: at("2026-10-03") }), {
      graceDays,
    });
    expect(result.dueDate).toBe("2026-10-03");
    expect(result.status).toBe(status);
  });

  it("activeSince from the state wins over changedAt", () => {
    const activeSince = at("2026-10-01");
    const result = run(isOn, sig({ text: "on" }), { state: { activeSince } });
    expect(result.dueDate).toBe("2026-10-01");
    expect(result.occurrenceKey).toBe(`s:${activeSince}`);
    expect(result.status).toBe("overdue");
  });

  it("an activeSince in the state is ignored while the predicate is false", () => {
    const result = run(isOn, sig({ text: "off" }), {
      state: { activeSince: at("2026-10-01") },
    });
    expect(result.status).toBe("ok");
    expect(result.occurrenceKey).toBe("s:none");
  });

  it.each([
    ["23:30 local", "2026-10-05T21:30:00Z", "2026-10-05"],
    ["00:30 local the next day", "2026-10-05T22:30:00Z", "2026-10-06"],
  ])("due date uses the household zone: %s", (_name, iso, date) => {
    const result = run(isOn, sig({ text: "on", changedAt: Date.parse(iso) }), {
      today: "2026-10-06",
    });
    expect(result.dueDate).toBe(date);
  });

  it.each([
    [
      "lt 20 with 15",
      cond({ entityId: ENTITY, op: "lt", value: 20 }),
      15,
      true,
    ],
    [
      "lt 20 with 20",
      cond({ entityId: ENTITY, op: "lt", value: 20 }),
      20,
      false,
    ],
    [
      "lte 20 with 20",
      cond({ entityId: ENTITY, op: "lte", value: 20 }),
      20,
      true,
    ],
    [
      "gt 80 with 81",
      cond({ entityId: ENTITY, op: "gt", value: 80 }),
      81,
      true,
    ],
    [
      "gte 80 with 80",
      cond({ entityId: ENTITY, op: "gte", value: 80 }),
      80,
      true,
    ],
    [
      "gte 80 with 79.9",
      cond({ entityId: ENTITY, op: "gte", value: 80 }),
      79.9,
      false,
    ],
    ["eq 0 with 0", cond({ entityId: ENTITY, op: "eq", value: 0 }), 0, true],
    ["ne 0 with 0", cond({ entityId: ENTITY, op: "ne", value: 0 }), 0, false],
  ])("numeric: %s", (_name, t, numeric, active) => {
    const result = run(t, sig({ numeric }));
    expect(result.status).toBe(active ? "due" : "ok");
  });
});

describe("state_condition, unavailable states", () => {
  it.each([
    ["unavailable with eq", "eq", "unavailable"],
    ["unavailable with ne", "ne", "unavailable"],
    ["unknown with ne", "ne", "unknown"],
  ] as const)("%s is never active", (_name, op, text) => {
    const t = cond({ entityId: ENTITY, op, value: op === "ne" ? "off" : "on" });
    const result = run(t, sig({ text }));
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["signal_unavailable"]);
    expect(result.dueKind).toBe("none");
  });

  it("numeric comparisons ignore unavailable too", () => {
    const t = cond({ entityId: ENTITY, op: "lt", value: 20 });
    expect(run(t, sig({ text: "unavailable", numeric: null })).status).toBe(
      "ok",
    );
  });
});

describe("state_condition, forMinutes", () => {
  const forHour = cond({
    entityId: ENTITY,
    op: "eq",
    value: "on",
    forMinutes: 60,
  });

  it.each([
    ["59 minutes", 59 * MIN, "ok", ["condition_pending"]],
    ["exactly 60 minutes", 60 * MIN, "due", ["condition_active"]],
    ["61 minutes", 61 * MIN, "due", ["condition_active"]],
    ["just changed", 0, "ok", ["condition_pending"]],
  ])("changed %s ago", (_name, ago, status, reasons) => {
    const result = run(forHour, sig({ text: "on", changedAt: NOW - ago }));
    expect(result.status).toBe(status);
    expect(result.reasons).toEqual(reasons);
    if (status === "ok") {
      expect(result.dueKind).toBe("none");
      expect(result.occurrenceKey).toBe("s:none");
    }
  });

  it("forMinutes 0 behaves like no delay", () => {
    const t = cond({ entityId: ENTITY, op: "eq", value: "on", forMinutes: 0 });
    expect(run(t, sig({ text: "on", changedAt: NOW })).status).toBe("due");
  });

  it("an older activeSince satisfies the delay even when changedAt is recent", () => {
    const result = run(forHour, sig({ text: "on", changedAt: NOW - MIN }), {
      state: { activeSince: NOW - 3 * HOUR },
    });
    expect(result.status).toBe("due");
  });

  it("a false predicate stays ok", () => {
    expect(
      run(forHour, sig({ text: "off", changedAt: NOW - 5 * HOUR })).status,
    ).toBe("ok");
  });

  it("pending does not report the unavailable reason", () => {
    const result = run(
      forHour,
      sig({ text: "unavailable", changedAt: NOW - 5 * HOUR }),
    );
    expect(result.reasons).toEqual(["signal_unavailable"]);
  });
});

describe("state_condition, acknowledgement", () => {
  const changedAt = NOW - 2 * HOUR;
  const active = sig({ text: "on", changedAt });

  it("a completion after the activation acknowledges it", () => {
    const result = run(isOn, active, {
      completions: [done(TODAY, { completedAt: NOW - HOUR })],
    });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual(["acknowledged"]);
    expect(result.dueKind).toBe("none");
    expect(result.occurrenceKey).toBe(`s:${changedAt}`);
  });

  it("a completion exactly at the activation acknowledges it", () => {
    const result = run(isOn, active, {
      completions: [done(TODAY, { completedAt: changedAt })],
    });
    expect(result.status).toBe("ok");
  });

  it("a completion just before the activation does not", () => {
    const result = run(isOn, active, {
      completions: [done(TODAY, { completedAt: changedAt - 1 })],
    });
    expect(result.status).toBe("due");
  });

  it("a skipped completion acknowledges as well", () => {
    const result = run(isOn, active, {
      completions: [skipped(TODAY, { completedAt: NOW - HOUR })],
    });
    expect(result.status).toBe("ok");
  });

  it("acknowledgement is measured against the state's activeSince", () => {
    const activeSince = NOW - 3 * HOUR;
    const completions = [done(TODAY, { completedAt: NOW - 2.5 * HOUR })];
    expect(
      run(isOn, active, { completions, state: { activeSince } }).status,
    ).toBe("ok");
    expect(
      run(isOn, active, { completions, state: { activeSince: NOW - HOUR } })
        .status,
    ).toBe("due");
  });

  it("the condition going false and true again is due again with a new key", () => {
    const first = run(isOn, active, {
      completions: [done(TODAY, { completedAt: NOW - HOUR })],
    });
    const again = run(isOn, sig({ text: "on", changedAt: NOW - 10 * MIN }), {
      completions: [done(TODAY, { completedAt: NOW - HOUR })],
    });
    expect(first.status).toBe("ok");
    expect(again.status).toBe("due");
    expect(again.occurrenceKey).not.toBe(first.occurrenceKey);
  });

  it("an ack does not carry over to an inactive condition", () => {
    const result = run(isOn, sig({ text: "off" }), {
      completions: [done(TODAY, { completedAt: NOW - HOUR })],
    });
    expect(result.reasons).toEqual([]);
    expect(result.occurrenceKey).toBe("s:none");
  });
});

describe("state_condition, estimates", () => {
  const BATTERY = "sensor.battery";
  const t = cond({
    entityId: ENTITY,
    op: "lt",
    value: 20,
    estimateFrom: { entityId: BATTERY, target: 20, direction: "down" },
  });
  const falling = (from: number, to: number, perDay: number): Sample[] => {
    const out: Sample[] = [];
    for (let o = from; o <= to; o += 1) {
      out.push({ at: at(addDays(TODAY, o)), value: 100 + perDay * (o - from) });
    }
    return out;
  };

  it("estimates when the source crosses the target", () => {
    const result = run(t, sig({ numeric: 60 }), {
      samples: { [BATTERY]: falling(-19, 0, -1) },
    });
    expect(result.status).toBe("ok");
    expect(result.dueKind).toBe("estimated");
    expect(result.dueDate).toBeNull();
    expect(result.estimate).toEqual({
      date: "2026-12-06",
      confidence: "medium",
    });
  });

  it("no estimate when the source is rising", () => {
    const result = run(t, sig({ numeric: 60 }), {
      samples: { [BATTERY]: falling(-19, 0, 1) },
    });
    expect(result.dueKind).toBe("none");
    expect(result.estimate).toBeUndefined();
  });

  it("no estimate without samples", () => {
    expect(run(t, sig({ numeric: 60 })).dueKind).toBe("none");
  });

  it("no estimate when the span is too short", () => {
    const result = run(t, sig({ numeric: 60 }), {
      samples: { [BATTERY]: falling(-5, 0, -1) },
    });
    expect(result.dueKind).toBe("none");
  });

  it("an active condition is due and carries no estimate", () => {
    const result = run(t, sig({ numeric: 10 }), {
      samples: { [BATTERY]: falling(-19, 0, -1) },
    });
    expect(result.status).toBe("due");
    expect(result.dueKind).toBe("condition");
    expect(result.estimate).toBeUndefined();
  });

  it("a stale signal is unknown even with estimate data", () => {
    const result = run(t, sig({ numeric: 60, seenAt: NOW - 30 * HOUR }), {
      samples: { [BATTERY]: falling(-19, 0, -1) },
    });
    expect(result.status).toBe("unknown");
  });
});
