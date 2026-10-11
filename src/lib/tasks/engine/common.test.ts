import { describe, expect, it } from "vitest";
import { isSignalFresh, lookupSignal } from "./common";
import { SIGNAL_STALE_MS } from "./types";

const NOW = Date.UTC(2026, 9, 6, 12);
const DAY = 86_400_000;

describe("isSignalFresh", () => {
  it.each([
    ["seen just now", undefined, 0, true],
    ["seen exactly a day ago", undefined, SIGNAL_STALE_MS, true],
    ["seen a day and a millisecond ago", undefined, SIGNAL_STALE_MS + 1, false],
    ["a home automation reading from last week", "ha", 7 * DAY, false],
    ["a reading without a source from last week", undefined, 7 * DAY, false],
    ["a manual reading from this morning", "manual", 3_600_000, true],
    ["a manual reading from last week", "manual", 7 * DAY, true],
    ["a manual reading from last year", "manual", 365 * DAY, true],
    ["the source is compared exactly", "Manual", 7 * DAY, false],
  ])("%s", (_name, source, age, expected) => {
    const signal = { seenAt: NOW - age, ...(source ? { source } : {}) };
    expect(isSignalFresh(signal, NOW)).toBe(expected);
  });
});

describe("lookupSignal", () => {
  const reading = (source?: string) => ({
    sensor: {
      numeric: 12,
      changedAt: NOW - 30 * DAY,
      seenAt: NOW - 30 * DAY,
      ...(source ? { source } : {}),
    },
  });

  it("reports a month-old reading as stale", () => {
    expect(
      lookupSignal({ signals: reading("ha"), now: NOW }, "sensor", "numeric"),
    ).toEqual({ ok: false, reason: "signal_stale" });
  });

  it("accepts a month-old manual reading", () => {
    const result = lookupSignal(
      { signals: reading("manual"), now: NOW },
      "sensor",
      "numeric",
    );
    expect(result.ok).toBe(true);
  });

  it("still needs a value from a manual reading", () => {
    const signals = {
      sensor: { numeric: null, changedAt: NOW, seenAt: NOW, source: "manual" },
    };
    expect(lookupSignal({ signals, now: NOW }, "sensor", "numeric")).toEqual({
      ok: false,
      reason: "signal_missing",
    });
  });
});
