import { describe, expect, it } from "vitest";
import {
  distanceBetween,
  distanceByMonth,
  monthsBetween,
  round1,
} from "./stats";

const r = (date: string, value: number) => ({ date, value });

describe("distanceBetween", () => {
  const readings = [
    r("2026-01-01", 10_000),
    r("2026-01-31", 11_000), // 1,000 km over the 30 days from 2 to 31 January
    r("2026-03-01", 12_000), // 1,000 km over the 29 days from 2 Feb to 1 March
  ];

  it.each([
    ["the whole span", "2026-01-01", "2026-03-01", 2_000],
    ["a year around it", "2026-01-01", "2026-12-31", 2_000],
    ["nothing before the first reading", "2025-01-01", "2025-12-31", 0],
    ["nothing after the last reading", "2026-03-02", "2026-12-31", 0],
    [
      "a stretch ending on the day of a reading",
      "2026-01-01",
      "2026-01-31",
      1_000,
    ],
    ["one day inside a stretch", "2026-01-15", "2026-01-15", 1_000 / 30],
    [
      "ten days of the second stretch",
      "2026-02-01",
      "2026-02-10",
      (1_000 * 10) / 29,
    ],
    [
      "from the middle of one stretch into the next",
      "2026-01-21",
      "2026-02-09",
      (1_000 * 11) / 30 + (1_000 * 9) / 29,
    ],
    ["a single day on which nothing happened", "2025-06-01", "2025-06-01", 0],
  ])("%s", (_name, from, to, expected) => {
    expect(distanceBetween(readings, from, to)).toBeCloseTo(expected, 9);
  });

  it("is zero with fewer than two readings", () => {
    expect(distanceBetween([], "2026-01-01", "2026-12-31")).toBe(0);
    expect(
      distanceBetween([r("2026-01-01", 5_000)], "2026-01-01", "2026-12-31"),
    ).toBe(0);
  });

  it("puts readings in order of their dates", () => {
    expect(
      distanceBetween(
        [r("2026-03-01", 12_000), r("2026-01-01", 10_000)],
        "2026-01-01",
        "2026-12-31",
      ),
    ).toBeCloseTo(2_000, 9);
  });

  it("gives the distance between readings of one day to that day", () => {
    const day = [
      r("2026-01-01", 10_000),
      r("2026-01-10", 10_100),
      r("2026-01-10", 10_160),
    ];
    expect(distanceBetween(day, "2026-01-10", "2026-01-10")).toBeCloseTo(
      60 + 100 / 9,
      9,
    );
    expect(distanceBetween(day, "2026-01-01", "2026-01-31")).toBeCloseTo(
      160,
      9,
    );
  });

  it("counts nothing for a reading lower than the one before", () => {
    const reset = [
      r("2026-01-01", 120_000),
      r("2026-02-01", 121_000),
      r("2026-03-01", 500), // the cluster was replaced
      r("2026-04-01", 1_500),
    ];
    expect(distanceBetween(reset, "2026-01-01", "2026-12-31")).toBeCloseTo(
      2_000,
      9,
    );
  });

  it("handles leap days and year ends", () => {
    const year = [r("2023-12-31", 0), r("2024-12-31", 3_660)]; // 366 days, 10 km a day
    expect(distanceBetween(year, "2024-02-29", "2024-02-29")).toBeCloseTo(
      10,
      9,
    );
    expect(distanceBetween(year, "2024-01-01", "2024-12-31")).toBeCloseTo(
      3_660,
      9,
    );
    expect(distanceBetween(year, "2023-12-01", "2024-01-31")).toBeCloseTo(
      310,
      9,
    );
  });
});

describe("distanceByMonth", () => {
  it("splits the stretches across the months they run through", () => {
    const readings = [r("2026-01-01", 10_000), r("2026-03-01", 12_950)];
    // 59 days from 2 January to 1 March, 50 km a day: 30 in January, 28 in February, 1 in March.
    const months = distanceByMonth(readings, [
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(months.map((m) => [m.month, Math.round(m.distance)])).toEqual([
      ["2025-12", 0],
      ["2026-01", 1_500],
      ["2026-02", 1_400],
      ["2026-03", 50],
      ["2026-04", 0],
    ]);
    expect(months.reduce((sum, m) => sum + m.distance, 0)).toBeCloseTo(
      2_950,
      6,
    );
  });

  it("keeps the order asked for", () => {
    const readings = [r("2026-01-01", 0), r("2026-02-01", 310)];
    expect(
      distanceByMonth(readings, ["2026-02", "2026-01"]).map((m) => m.month),
    ).toEqual(["2026-02", "2026-01"]);
  });
});

describe("monthsBetween", () => {
  it.each([
    ["2026-03", "2026-03", ["2026-03"]],
    ["2025-11", "2026-02", ["2025-11", "2025-12", "2026-01", "2026-02"]],
    ["2026-05", "2026-03", []],
  ])("%s to %s", (from, to, expected) => {
    expect(monthsBetween(from, to)).toEqual(expected);
  });
});

describe("round1", () => {
  it.each([
    [1234.56, 1234.6],
    [0.04, 0],
    [2.25, 2.3],
    [-1.25, -1.2],
  ])("%s", (value, expected) => {
    expect(round1(value)).toBe(expected);
  });
});
