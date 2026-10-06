import { describe, expect, it } from "vitest";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt } from "$lib/testing/domain";
import {
  SAMPLE_INTERVAL_MS,
  getSignal,
  hasExternalDates,
  listSamples,
  pruneSignals,
  replaceExternalDates,
  upsertSignals,
} from "./service";
import { loadSignalsFromDb } from "$lib/server/tasks/signals";

const KEY = "sensor.example_counter";
const reading = (
  over: Partial<Parameters<typeof upsertSignals>[1][number]> = {},
) => ({
  key: KEY,
  numeric: 5,
  text: "5",
  unit: "x",
  changedAt: at("2026-06-15", "08:00"),
  ...over,
});

describe("signals service", () => {
  const test = useTestDB();
  const ctx = (when = "2026-06-15", time = "12:00") =>
    ctxAt(test.db, at(when, time));

  it("stores a first reading as a change without a previous value", () => {
    const { changes, skipped } = upsertSignals(ctx(), [reading()], "ha");
    expect(skipped).toBe(0);
    expect(changes).toEqual([
      {
        key: KEY,
        prev: null,
        next: { numeric: 5, text: "5", changedAt: at("2026-06-15", "08:00") },
      },
    ]);
    expect(getSignal(ctx(), KEY)).toMatchObject({
      numeric: 5,
      text: "5",
      unit: "x",
      source: "ha",
    });
    expect(getSignal(ctx(), KEY)?.seenAt.getTime()).toBe(
      at("2026-06-15", "12:00"),
    );
  });

  it("reports a change with the previous value, and none for the same value", () => {
    upsertSignals(ctx(), [reading()], "ha");
    expect(
      upsertSignals(ctx("2026-06-15", "12:01"), [reading()], "ha").changes,
    ).toEqual([]);
    // "5" and "5.0" are the same number
    expect(
      upsertSignals(
        ctx("2026-06-15", "12:02"),
        [reading({ text: "5.0" })],
        "ha",
      ).changes,
    ).toEqual([]);
    const { changes } = upsertSignals(
      ctx("2026-06-15", "12:03"),
      [reading({ numeric: 9, text: "9" })],
      "ha",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].prev).toMatchObject({ numeric: 5 });
    expect(changes[0].next).toMatchObject({ numeric: 9 });
  });

  it("compares text for states that are not numbers", () => {
    const state = (text: string) => ({ numeric: null, text, unit: null });
    upsertSignals(ctx(), [reading(state("off"))], "ha");
    expect(upsertSignals(ctx(), [reading(state("off"))], "ha").changes).toEqual(
      [],
    );
    expect(
      upsertSignals(ctx(), [reading(state("on"))], "ha").changes,
    ).toHaveLength(1);
    // a number turning into text is a change too
    expect(
      upsertSignals(ctx(), [reading({ numeric: 3, text: "3" })], "ha").changes,
    ).toHaveLength(1);
  });

  it("keeps the last known value when a reading carries none", () => {
    upsertSignals(ctx(), [reading()], "ha");
    const { changes, skipped } = upsertSignals(
      ctx("2026-06-15", "13:00"),
      [reading({ numeric: null, text: null })],
      "ha",
    );
    expect(skipped).toBe(1);
    expect(changes).toEqual([]);
    expect(getSignal(ctx(), KEY)).toMatchObject({ numeric: 5, text: "5" });
    expect(getSignal(ctx(), KEY)?.seenAt.getTime()).toBe(
      at("2026-06-15", "12:00"),
    );
  });

  it("keeps the unit when a later reading has none", () => {
    upsertSignals(ctx(), [reading()], "ha");
    upsertSignals(
      ctx(),
      [reading({ numeric: 6, text: "6", unit: null })],
      "ha",
    );
    expect(getSignal(ctx(), KEY)?.unit).toBe("x");
  });

  describe("samples", () => {
    it("writes one on change and then at most every six hours", () => {
      const t0 = at("2026-06-15", "00:00");
      upsertSignals(ctxAt(test.db, t0), [reading()], "ha");
      upsertSignals(ctxAt(test.db, t0 + 60_000), [reading()], "ha");
      expect(listSamples(ctx(), KEY)).toHaveLength(1);
      upsertSignals(
        ctxAt(test.db, t0 + 120_000),
        [reading({ numeric: 6, text: "6" })],
        "ha",
      );
      expect(listSamples(ctx(), KEY)).toHaveLength(2);
      upsertSignals(
        ctxAt(test.db, t0 + 3 * 60 * 60_000),
        [reading({ numeric: 6, text: "6" })],
        "ha",
      );
      expect(listSamples(ctx(), KEY)).toHaveLength(2);
      upsertSignals(
        ctxAt(test.db, t0 + 120_000 + SAMPLE_INTERVAL_MS),
        [reading({ numeric: 6, text: "6" })],
        "ha",
      );
      const samples = listSamples(ctx(), KEY);
      expect(samples).toHaveLength(3);
      expect(samples.map((s) => s.value)).toEqual([6, 6, 5]);
    });

    it("writes none for states that are not numbers", () => {
      upsertSignals(ctx(), [reading({ numeric: null, text: "on" })], "ha");
      expect(listSamples(ctx(), KEY)).toEqual([]);
    });

    it("are pruned after a year, together with signals nobody read for 90 days", () => {
      const old = at("2025-01-01");
      upsertSignals(ctxAt(test.db, old), [reading()], "ha");
      upsertSignals(ctx(), [reading({ key: "sensor.example_other" })], "ha");
      const result = pruneSignals(ctx(), ["x#"]);
      expect(result).toMatchObject({ samples: 1, signals: 1 });
      expect(getSignal(ctx(), KEY)).toBeUndefined();
      expect(getSignal(ctx(), "sensor.example_other")).toBeDefined();
    });
  });

  describe("external dates", () => {
    const key = "calendar.example_waste#paper";

    it("replaces the dates of a key and reports whether anything changed", () => {
      expect(
        replaceExternalDates(ctx(), key, [
          { date: "2026-06-20", title: "Paper" },
          { date: "2026-07-04" },
        ]),
      ).toBe(true);
      expect(hasExternalDates(ctx(), key)).toBe(true);
      expect(
        replaceExternalDates(ctx(), key, [
          { date: "2026-07-04" },
          { date: "2026-06-20", title: "Paper" },
        ]),
      ).toBe(false);
      expect(replaceExternalDates(ctx(), key, [{ date: "2026-07-04" }])).toBe(
        true,
      );
      const loaded = loadSignalsFromDb(
        test.db,
        {
          entityIds: [],
          calendars: [{ key, entityId: "calendar.example_waste" }],
        },
        ctx().now,
      );
      expect(loaded.externalDates[key]).toEqual(["2026-07-04"]);
    });

    it("keeps keys apart and drops the dates of subscriptions nobody uses", () => {
      replaceExternalDates(ctx(), "a#", [{ date: "2026-06-20" }]);
      replaceExternalDates(ctx(), "b#", [{ date: "2026-06-21" }]);
      replaceExternalDates(ctx(), "a#", []);
      expect(hasExternalDates(ctx(), "a#")).toBe(false);
      expect(hasExternalDates(ctx(), "b#")).toBe(true);
      expect(pruneSignals(ctx(), []).dates).toBe(1);
      expect(hasExternalDates(ctx(), "b#")).toBe(false);
    });
  });
});

describe("loadSignalsFromDb", () => {
  const test = useTestDB();

  it("maps stored readings and the last 100 days of samples", () => {
    const now = at("2026-06-15");
    const c = ctxAt(test.db, now);
    upsertSignals(
      ctxAt(test.db, now - 200 * 24 * 3600_000),
      [reading({ numeric: 1, text: "1" })],
      "ha",
    );
    upsertSignals(
      ctxAt(test.db, now - 10 * 24 * 3600_000),
      [reading({ numeric: 2, text: "2" })],
      "ha",
    );
    upsertSignals(c, [reading({ numeric: 3, text: "3" })], "ha");
    const out = loadSignalsFromDb(
      test.db,
      { entityIds: [KEY], calendars: [] },
      now,
    );
    expect(out.signals[KEY]).toMatchObject({ numeric: 3, text: "3" });
    expect(out.samples[KEY].map((s) => s.value)).toEqual([2, 3]);
    expect(out.externalDates).toEqual({});
  });
});
