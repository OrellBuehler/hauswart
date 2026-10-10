import { describe, expect, it } from "vitest";
import type { TireEventFacts } from "./tires";
import {
  TREAD_WARNING_MM,
  isValidDot,
  parseDot,
  tireAgeYears,
  tireSetDistance,
  treadWarning,
} from "./tires";

describe("treadWarning", () => {
  it("keeps the limits in one place", () => {
    expect(TREAD_WARNING_MM).toEqual({ summer: 3, winter: 4, all_season: 4 });
  });

  it.each([
    ["summer", 3.5, false],
    ["summer", 3, false],
    ["summer", 2.9, true],
    ["winter", 4, false],
    ["winter", 3.9, true],
    ["winter", 8, false],
    ["all_season", 3.9, true],
    ["all_season", 4, false],
    ["winter", 0, true],
    ["winter", null, false],
    ["summer", undefined, false],
    ["summer", Number.NaN, false],
  ] as const)("%s at %s mm: %s", (season, depth, expected) => {
    expect(treadWarning(season, depth)).toBe(expected);
  });
});

describe("DOT codes", () => {
  it.each([
    ["2423", true, { week: 24, year: 2023 }],
    ["0100", true, { week: 1, year: 2000 }],
    ["5399", true, { week: 53, year: 2099 }],
    ["0023", false, null],
    ["5423", false, null],
    ["242", false, null],
    ["24234", false, null],
    ["24a3", false, null],
    ["", false, null],
  ])("%j: valid %s", (dot, valid, parsed) => {
    expect(isValidDot(dot)).toBe(valid);
    expect(parseDot(dot)).toEqual(parsed);
  });

  it.each([
    ["new this year", "2426", "2026-06-15", 0],
    ["two years", "2424", "2026-06-15", 2],
    ["a year and a half", "0125", "2026-07-01", 1.5],
    ["just made", "2426", "2026-06-10", 0],
    ["made in the future counts as new", "5230", "2026-06-15", 0],
    ["six years", "2420", "2026-06-15", 6],
  ])("age: %s", (_name, dot, today, years) => {
    expect(tireAgeYears(dot, today)).toBe(years);
  });

  it("has no age without a valid code", () => {
    expect(tireAgeYears(null, "2026-06-15")).toBeNull();
    expect(tireAgeYears(undefined, "2026-06-15")).toBeNull();
    expect(tireAgeYears("9999", "2026-06-15")).toBeNull();
    expect(tireAgeYears("abcd", "2026-06-15")).toBeNull();
  });
});

describe("tireSetDistance", () => {
  const e = (
    kind: TireEventFacts["kind"],
    date: string,
    odometer: number | null = null,
  ): TireEventFacts => ({ kind, date, odometer });
  const readings = [
    { date: "2025-01-01", value: 10_000 },
    { date: "2025-06-01", value: 14_000 },
    { date: "2025-11-01", value: 19_000 },
    { date: "2026-04-01", value: 24_000 },
    { date: "2026-09-01", value: 30_000 },
  ];

  it.each([
    ["never mounted", [], 0],
    ["only measured", [e("tread_measured", "2025-02-01")], 0],
    [
      "one stretch with the odometer on the events",
      [
        e("mounted", "2025-11-01", 19_000),
        e("unmounted", "2026-04-01", 24_100),
      ],
      5_100,
    ],
    [
      "one stretch with the odometer taken from the readings",
      [e("mounted", "2025-11-01"), e("unmounted", "2026-04-01")],
      5_000,
    ],
    [
      "a reading on the day of the event counts, an older one is used otherwise",
      [e("mounted", "2025-12-15"), e("unmounted", "2026-05-15")],
      5_000,
    ],
    [
      "two stretches add up",
      [
        e("mounted", "2025-01-01"),
        e("unmounted", "2025-06-01"),
        e("mounted", "2025-11-01"),
        e("unmounted", "2026-04-01"),
      ],
      9_000,
    ],
    [
      "a set still mounted runs to the newest reading",
      [e("mounted", "2026-04-01")],
      6_000,
    ],
    [
      "a mount without a closing unmount before the next mount closes at the new mount",
      [e("mounted", "2025-01-01"), e("mounted", "2025-06-01")],
      4_000 + 16_000,
    ],
    [
      "events given out of order are put in order of their dates",
      [e("unmounted", "2025-06-01"), e("mounted", "2025-01-01")],
      4_000,
    ],
    [
      "events of one day stay in the order given",
      [
        e("mounted", "2026-04-01", 24_000),
        e("unmounted", "2026-04-01", 24_000),
        e("mounted", "2026-04-01", 24_000),
      ],
      6_000,
    ],
    [
      "a measurement in between changes nothing",
      [
        e("mounted", "2025-01-01"),
        e("tread_measured", "2025-03-01", 12_000),
        e("unmounted", "2025-06-01"),
      ],
      4_000,
    ],
    [
      "an odometer that went down counts as nothing for that stretch",
      [e("mounted", "2025-06-01", 90_000), e("unmounted", "2025-11-01", 500)],
      0,
    ],
  ])("%s", (_name, events, expected) => {
    expect(tireSetDistance(events, readings)).toBe(expected);
  });

  it("is unknown when mounted but nothing can be measured", () => {
    expect(tireSetDistance([e("mounted", "2025-01-01")], [])).toBeNull();
    expect(
      tireSetDistance(
        [e("mounted", "2024-01-01"), e("unmounted", "2024-06-01")],
        [{ date: "2025-01-01", value: 10_000 }],
      ),
    ).toBeNull();
  });

  it("counts the stretches it can measure when others are unknown", () => {
    expect(
      tireSetDistance(
        [
          e("mounted", "2024-01-01"),
          e("unmounted", "2024-06-01"),
          e("mounted", "2025-01-01"),
          e("unmounted", "2025-06-01"),
        ],
        readings,
      ),
    ).toBe(4_000);
  });
});
