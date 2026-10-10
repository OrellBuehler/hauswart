import { describe, expect, it } from "vitest";
import { addDays } from "$lib/dates";
import {
  SPARSE_WINDOWS_DAYS,
  estimateCrossing,
  estimateFromCompletions,
} from "./estimate";
import { at, done, skipped, TZ } from "./testing";
import type { Sample } from "./types";

const TODAY = "2026-10-06";

function series(
  fromOffset: number,
  toOffset: number,
  value: (offset: number) => number,
  time = "12:00",
): Sample[] {
  const out: Sample[] = [];
  for (let offset = fromOffset; offset <= toOffset; offset += 1) {
    out.push({ at: at(addDays(TODAY, offset), time), value: value(offset) });
  }
  return out;
}

const cross = (
  samples: Sample[],
  target: number,
  direction: "up" | "down",
  current?: number,
) =>
  estimateCrossing(
    samples,
    current === undefined
      ? { target, direction }
      : { target, direction, current },
    TODAY,
    TZ,
  );

describe("estimateCrossing", () => {
  it.each([
    [
      "28 days at +2/day, 46 left",
      series(-27, 0, (o) => 2 * (o + 27)),
      100,
      "up",
      "2026-10-29",
      "medium",
    ],
    [
      "10 days at +1/day is low confidence",
      series(-10, 0, (o) => o + 10),
      20,
      "up",
      "2026-10-16",
      "low",
    ],
    [
      "13 days span is low",
      series(-13, 0, (o) => o + 13),
      23,
      "up",
      "2026-10-16",
      "low",
    ],
    [
      "14 days span is medium",
      series(-14, 0, (o) => o + 14),
      24,
      "up",
      "2026-10-16",
      "medium",
    ],
    [
      "exactly 7 days span is enough",
      series(-7, 0, (o) => 3 * (o + 7)),
      51,
      "up",
      "2026-10-16",
      "low",
    ],
    [
      "falling battery",
      series(-19, 0, (o) => 100 - (o + 19)),
      20,
      "down",
      "2026-12-06",
      "medium",
    ],
    [
      "remaining rounds up to a whole day",
      series(-9, 0, (o) => 2 * (o + 9)),
      41,
      "up",
      "2026-10-18",
      "low",
    ],
    [
      "exact division does not overshoot by float noise",
      series(-9, 0, (o) => 0.1 * (o + 9)),
      1.9,
      "up",
      "2026-10-16",
      "low",
    ],
  ] as const)("%s", (_name, samples, target, direction, date, confidence) => {
    expect(cross([...samples], target, direction)).toEqual({
      date,
      confidence,
    });
  });

  it("returns null without samples", () => {
    expect(cross([], 10, "up")).toBeNull();
  });

  it("returns null with a single sample", () => {
    expect(
      cross(
        series(0, 0, () => 5),
        10,
        "up",
      ),
    ).toBeNull();
  });

  it("returns null when the span is under 7 days", () => {
    expect(
      cross(
        series(-6, 0, (o) => o + 6),
        100,
        "up",
      ),
    ).toBeNull();
  });

  it("returns null when samples share a timestamp", () => {
    const s = at(TODAY);
    expect(
      cross(
        [
          { at: s, value: 1 },
          { at: s, value: 5 },
        ],
        10,
        "up",
      ),
    ).toBeNull();
  });

  it("returns null for a flat series", () => {
    expect(
      cross(
        series(-20, 0, () => 5),
        10,
        "up",
      ),
    ).toBeNull();
    expect(
      cross(
        series(-20, 0, () => 5),
        1,
        "down",
      ),
    ).toBeNull();
  });

  it("returns null when the trend points away from the target", () => {
    expect(
      cross(
        series(-20, 0, (o) => 100 - o),
        150,
        "up",
      ),
    ).toBeNull();
    expect(
      cross(
        series(-20, 0, (o) => o + 20),
        0,
        "down",
      ),
    ).toBeNull();
  });

  it("returns null when the target is already crossed", () => {
    expect(
      cross(
        series(-20, 0, (o) => o + 20),
        15,
        "up",
      ),
    ).toBeNull();
    expect(
      cross(
        series(-20, 0, (o) => o + 20),
        20,
        "up",
      ),
    ).toBeNull();
    expect(
      cross(
        series(-20, 0, (o) => 100 - (o + 20)),
        90,
        "down",
      ),
    ).toBeNull();
  });

  it("clamps the estimate to 365 days", () => {
    expect(
      cross(
        series(-20, 0, (o) => 0.01 * (o + 20)),
        1000,
        "up",
      ),
    ).toEqual({
      date: "2027-10-06",
      confidence: "medium",
    });
  });

  it("uses an explicit current value", () => {
    expect(
      cross(
        series(-19, 0, (o) => o + 19),
        100,
        "up",
        90,
      ),
    ).toEqual({
      date: "2026-10-16",
      confidence: "medium",
    });
  });

  it("ignores samples from the future", () => {
    const samples = [
      ...series(-20, 0, (o) => o + 20),
      ...series(1, 30, () => 9999),
    ];
    expect(cross(samples, 30, "up")).toEqual({
      date: "2026-10-16",
      confidence: "medium",
    });
  });

  it("sorts samples itself", () => {
    const samples = series(-20, 0, (o) => o + 20).reverse();
    expect(cross(samples, 30, "up")).toEqual({
      date: "2026-10-16",
      confidence: "medium",
    });
  });

  it("ignores non-finite samples", () => {
    const samples = [
      ...series(-20, 0, (o) => o + 20),
      { at: at(TODAY), value: Number.NaN },
      { at: Number.NaN, value: 3 },
    ];
    expect(cross(samples, 30, "up")?.date).toBe("2026-10-16");
  });

  it("prefers the recent 28 days over older history", () => {
    const samples = [
      ...series(-60, -29, (o) => o + 60),
      ...series(-28, 0, (o) => 31 + 5 * (o + 29)),
    ];
    expect(cross(samples, 276, "up")).toEqual({
      date: "2026-10-26",
      confidence: "medium",
    });
  });

  it("falls back to 90 days when the last 28 have too little data", () => {
    const samples = series(-60, -40, (o) => 2 * (o + 60));
    expect(cross(samples, 300, "up")).toEqual({
      date: "2027-01-04",
      confidence: "medium",
    });
  });

  it("falls back to 90 days when only one sample is recent", () => {
    const samples = [
      ...series(-60, -40, (o) => 2 * (o + 60)),
      ...series(0, 0, () => 40),
    ];
    expect(cross(samples, 100, "up")).not.toBeNull();
  });

  it("returns null when even 90 days are not enough", () => {
    expect(
      cross(
        series(-120, -100, (o) => o + 120),
        1000,
        "up",
      ),
    ).toBeNull();
  });

  it("looks back a year for sparse readings when asked to", () => {
    const sparse = [
      { at: at(addDays(TODAY, -200)), value: 1000 },
      { at: at(addDays(TODAY, -100)), value: 2000 },
    ];
    const target = { target: 4000, direction: "up", current: 2000 } as const;
    expect(estimateCrossing(sparse, target, TODAY, TZ)).toBeNull();
    expect(
      estimateCrossing(sparse, target, TODAY, TZ, SPARSE_WINDOWS_DAYS),
    ).toEqual({ date: "2027-01-14", confidence: "medium" });
  });

  describe("anchored at the newest sample, not at today", () => {
    const sparse = [
      { at: at(addDays(TODAY, -200)), value: 1000 },
      { at: at(addDays(TODAY, -100)), value: 2000 },
    ];
    const reach = (target: number, today = TODAY) =>
      estimateCrossing(
        sparse,
        { target, direction: "up", current: 2000 },
        today,
        TZ,
        SPARSE_WINDOWS_DAYS,
      );

    it("counts the days from the day of the newest reading", () => {
      expect(reach(4000)).toEqual({ date: "2027-01-14", confidence: "medium" });
    });

    it("says the same on every day until a new reading arrives", () => {
      for (const offset of [0, 1, 7, 30, 60]) {
        expect(reach(4000, addDays(TODAY, offset))).toEqual({
          date: "2027-01-14",
          confidence: "medium",
        });
      }
    });

    it("answers tomorrow with low confidence once the date has passed", () => {
      // 500 left at 10 a day: 50 days after the newest reading, which is long gone.
      expect(reach(2500)).toEqual({ date: "2026-10-07", confidence: "low" });
      expect(reach(2500, "2026-12-01")).toEqual({
        date: "2026-12-02",
        confidence: "low",
      });
      // The day itself is not after today either.
      expect(reach(2500, "2026-08-17")).toEqual({
        date: "2026-08-18",
        confidence: "low",
      });
      expect(reach(2500, "2026-08-16")).toEqual({
        date: "2026-08-17",
        confidence: "medium",
      });
    });

    it("is unchanged for readings that come in daily", () => {
      const daily = series(-27, 0, (o) => 2 * (o + 27));
      expect(cross(daily, 100, "up")).toEqual({
        date: "2026-10-29",
        confidence: "medium",
      });
    });

    it("counts from yesterday when the newest reading is from yesterday", () => {
      const quiet = series(-28, -1, (o) => 2 * (o + 28));
      expect(cross(quiet, 100, "up")).toEqual({
        date: "2026-10-28",
        confidence: "medium",
      });
    });
  });

  it("still prefers the nearest window with enough data", () => {
    const samples = series(-27, 0, (o) => 2 * (o + 27));
    expect(
      estimateCrossing(
        samples,
        { target: 100, direction: "up" },
        TODAY,
        TZ,
        SPARSE_WINDOWS_DAYS,
      ),
    ).toEqual(cross(samples, 100, "up"));
  });

  it("assigns samples to local days of the time zone", () => {
    const edge = [
      { at: at(addDays(TODAY, -29), "23:30"), value: 0 },
      { at: at(addDays(TODAY, -22), "23:30"), value: 7 },
    ];
    expect(cross(edge, 20, "up")).not.toBeNull();
    const inside = [
      { at: at(addDays(TODAY, -28), "00:30"), value: 0 },
      { at: at(addDays(TODAY, -21), "00:30"), value: 7 },
    ];
    expect(cross(inside, 120, "up")).toEqual({
      date: "2027-01-06",
      confidence: "low",
    });
  });

  it("fits a least squares line through noisy data", () => {
    const noisy = series(
      -9,
      0,
      (o) => 2 * (o + 9) + ((o + 9) % 2 === 0 ? 1 : -1),
    );
    expect(cross(noisy, 120, "up", 20)).toEqual({
      date: "2026-11-27",
      confidence: "low",
    });
  });
});

describe("estimateFromCompletions", () => {
  it.each([
    ["no completions", [], null],
    ["a single completion", [done("2026-09-01")], null],
    [
      "skipped ones are ignored",
      [done("2026-09-01"), skipped("2026-09-20")],
      null,
    ],
    [
      "two completions repeat the interval",
      [done("2026-08-01"), done("2026-09-01")],
      "2026-10-02",
    ],
    [
      "three completions use the mean of two intervals",
      [done("2026-06-01"), done("2026-07-01"), done("2026-08-11")],
      "2026-09-16",
    ],
    [
      "only the last three count",
      [
        done("2025-01-01"),
        done("2026-06-01"),
        done("2026-07-01"),
        done("2026-08-01"),
      ],
      "2026-09-01",
    ],
    [
      "mean .5 rounds up",
      [done("2026-07-01"), done("2026-07-11"), done("2026-07-22")],
      "2026-08-02",
    ],
    [
      "unsorted input",
      [done("2026-09-01"), done("2026-07-01"), done("2026-08-01")],
      "2026-10-02",
    ],
    [
      "same day completions still advance one day",
      [
        done("2026-09-01", { time: "08:00" }),
        done("2026-09-01", { time: "09:00" }),
      ],
      "2026-09-02",
    ],
    [
      "skipped ones between do not distort",
      [done("2026-08-01"), skipped("2026-08-15"), done("2026-09-01")],
      "2026-10-02",
    ],
  ] as const)("%s", (_name, completions, date) => {
    const result = estimateFromCompletions([...completions]);
    if (date === null) expect(result).toBeNull();
    else expect(result).toEqual({ date, confidence: "low" });
  });
});
