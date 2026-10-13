import { describe, expect, it } from "vitest";
import {
  RECURRENCE_BOOKING_CAP,
  dueOccurrences,
  firstOccurrence,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  type RecurrenceRule,
} from "./recurrence";

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  dayOfMonth: 1,
  startDate: "2026-01-01",
  endDate: null,
  ...over,
});

describe("recurrence", () => {
  describe("firstOccurrence", () => {
    it.each<[string, Partial<RecurrenceRule>, string | null]>([
      ["the start date itself when it is on the day", {}, "2026-01-01"],
      [
        "the same month when the day is still ahead",
        { startDate: "2026-01-10", dayOfMonth: 15 },
        "2026-01-15",
      ],
      [
        "the next month when the day has passed",
        { startDate: "2026-01-20", dayOfMonth: 15 },
        "2026-02-15",
      ],
      [
        "the next month across a year end",
        { startDate: "2026-12-20", dayOfMonth: 5 },
        "2027-01-05",
      ],
      [
        "the end of a short month for day 31",
        { startDate: "2026-02-10", dayOfMonth: 31 },
        "2026-02-28",
      ],
      [
        "the 29th of February in a leap year",
        { startDate: "2028-02-01", dayOfMonth: 31 },
        "2028-02-29",
      ],
      [
        "the start month of a quarterly rule",
        { frequency: "quarterly", startDate: "2026-02-03", dayOfMonth: 3 },
        "2026-02-03",
      ],
      [
        "the next quarter when the day of the start month has passed",
        { frequency: "quarterly", startDate: "2026-02-20", dayOfMonth: 3 },
        "2026-05-03",
      ],
      [
        "a yearly rule on a day that has passed this year",
        { frequency: "yearly", startDate: "2026-06-20", dayOfMonth: 1 },
        "2027-06-01",
      ],
      [
        "nothing when the first occurrence is after the end date",
        { startDate: "2026-01-20", dayOfMonth: 15, endDate: "2026-02-01" },
        null,
      ],
      [
        "the first occurrence on the end date itself",
        { startDate: "2026-01-20", dayOfMonth: 15, endDate: "2026-02-15" },
        "2026-02-15",
      ],
    ])("%s", (_name, over, expected) => {
      expect(firstOccurrence(rule(over))).toBe(expected);
    });
  });

  describe("occurrencesBetween", () => {
    it.each<[string, Partial<RecurrenceRule>, string, string, string[]]>([
      [
        "monthly on the 31st clamps to each month's end without drifting",
        { startDate: "2026-01-31", dayOfMonth: 31 },
        "2026-01-01",
        "2026-06-30",
        [
          "2026-01-31",
          "2026-02-28",
          "2026-03-31",
          "2026-04-30",
          "2026-05-31",
          "2026-06-30",
        ],
      ],
      [
        "monthly on the 29th meets 29 February only in a leap year",
        { startDate: "2027-12-29", dayOfMonth: 29 },
        "2027-12-01",
        "2028-03-31",
        ["2027-12-29", "2028-01-29", "2028-02-29", "2028-03-29"],
      ],
      [
        "monthly on the 30th in a non-leap February",
        { startDate: "2026-12-30", dayOfMonth: 30 },
        "2026-12-01",
        "2027-03-31",
        ["2026-12-30", "2027-01-30", "2027-02-28", "2027-03-30"],
      ],
      [
        "every second month",
        { interval: 2, startDate: "2026-01-15", dayOfMonth: 15 },
        "2026-01-01",
        "2026-12-31",
        [
          "2026-01-15",
          "2026-03-15",
          "2026-05-15",
          "2026-07-15",
          "2026-09-15",
          "2026-11-15",
        ],
      ],
      [
        "quarterly starting in November runs over the year end",
        { frequency: "quarterly", startDate: "2026-11-30", dayOfMonth: 30 },
        "2026-11-01",
        "2027-12-31",
        ["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30", "2027-11-30"],
      ],
      [
        "every second quarter",
        {
          frequency: "quarterly",
          interval: 2,
          startDate: "2026-03-01",
          dayOfMonth: 1,
        },
        "2026-01-01",
        "2027-12-31",
        ["2026-03-01", "2026-09-01", "2027-03-01", "2027-09-01"],
      ],
      [
        "yearly on 29 February falls back to the 28th in the years between",
        { frequency: "yearly", startDate: "2028-02-29", dayOfMonth: 29 },
        "2028-01-01",
        "2032-12-31",
        ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"],
      ],
      [
        "every second year",
        {
          frequency: "yearly",
          interval: 2,
          startDate: "2026-04-10",
          dayOfMonth: 10,
        },
        "2026-01-01",
        "2031-12-31",
        ["2026-04-10", "2028-04-10", "2030-04-10"],
      ],
      [
        "stops at the end date, which is included",
        { endDate: "2026-03-01" },
        "2026-01-01",
        "2026-12-31",
        ["2026-01-01", "2026-02-01", "2026-03-01"],
      ],
      [
        "stops before an end date that falls between two occurrences",
        { endDate: "2026-02-28" },
        "2026-01-01",
        "2026-12-31",
        ["2026-01-01", "2026-02-01"],
      ],
      [
        "never before the start date",
        { startDate: "2026-03-10", dayOfMonth: 10 },
        "2025-01-01",
        "2026-05-31",
        ["2026-03-10", "2026-04-10", "2026-05-10"],
      ],
      [
        "only the occurrences inside the window, both ends included",
        {},
        "2026-02-01",
        "2026-04-01",
        ["2026-02-01", "2026-03-01", "2026-04-01"],
      ],
      ["nothing in an empty window", {}, "2026-02-02", "2026-02-28", []],
    ])("%s", (_name, over, from, to, expected) => {
      expect(occurrencesBetween(rule(over), from, to)).toEqual(expected);
    });

    it("is bounded by the limit", () => {
      const out = occurrencesBetween(rule(), "2000-01-01", "2100-12-31", 5);
      expect(out).toHaveLength(5);
      expect(out[0]).toBe("2026-01-01");
    });
  });

  describe("nextOccurrenceAfter", () => {
    it.each<[string, Partial<RecurrenceRule>, string, string | null]>([
      ["the following month", {}, "2026-01-01", "2026-02-01"],
      [
        "the same month when the date is before the day",
        { dayOfMonth: 20, startDate: "2026-01-20" },
        "2026-02-10",
        "2026-02-20",
      ],
      [
        "the next month when the date is on the day",
        { dayOfMonth: 20, startDate: "2026-01-20" },
        "2026-02-20",
        "2026-03-20",
      ],
      [
        "the next month when the date is past the day",
        { dayOfMonth: 20, startDate: "2026-01-20" },
        "2026-02-21",
        "2026-03-20",
      ],
      [
        "the clamped end of a short month, then the full day again",
        { dayOfMonth: 31, startDate: "2026-01-31" },
        "2026-01-31",
        "2026-02-28",
      ],
      [
        "the 31st after a clamped February",
        { dayOfMonth: 31, startDate: "2026-01-31" },
        "2026-02-28",
        "2026-03-31",
      ],
      [
        "a date before the start date gives the first occurrence",
        { startDate: "2026-05-01" },
        "2020-01-01",
        "2026-05-01",
      ],
      [
        "a date a day before the start date gives the start date",
        { startDate: "2026-05-01" },
        "2026-04-30",
        "2026-05-01",
      ],
      [
        "the quarter after the date",
        { frequency: "quarterly", startDate: "2026-01-15", dayOfMonth: 15 },
        "2026-01-15",
        "2026-04-15",
      ],
      [
        "a quarterly date between two occurrences",
        { frequency: "quarterly", startDate: "2026-01-15", dayOfMonth: 15 },
        "2026-02-01",
        "2026-04-15",
      ],
      [
        "the next year over a year end",
        { frequency: "yearly", startDate: "2026-12-31", dayOfMonth: 31 },
        "2026-12-31",
        "2027-12-31",
      ],
      [
        "nothing after the end date",
        { endDate: "2026-03-01" },
        "2026-03-01",
        null,
      ],
      [
        "nothing when the next one would pass the end date",
        { endDate: "2026-03-15" },
        "2026-03-01",
        null,
      ],
      [
        "the last one before the end date",
        { endDate: "2026-03-15" },
        "2026-02-01",
        "2026-03-01",
      ],
    ])("%s", (_name, over, after, expected) => {
      expect(nextOccurrenceAfter(rule(over), after)).toBe(expected);
    });
  });

  describe("nextOccurrenceOnOrAfter", () => {
    it.each<[string, Partial<RecurrenceRule>, string, string | null]>([
      [
        "the date itself when it is an occurrence",
        {},
        "2026-03-01",
        "2026-03-01",
      ],
      ["the next one otherwise", {}, "2026-03-02", "2026-04-01"],
      [
        "the first one for a date before the start",
        { startDate: "2026-05-01" },
        "2025-01-01",
        "2026-05-01",
      ],
      [
        "nothing once the series is over",
        { endDate: "2026-03-01" },
        "2026-03-02",
        null,
      ],
    ])("%s", (_name, over, from, expected) => {
      expect(nextOccurrenceOnOrAfter(rule(over), from)).toBe(expected);
    });
  });

  describe("dueOccurrences", () => {
    it.each<[string, Partial<RecurrenceRule>, string | null, string, string[]]>(
      [
        [
          "every occurrence since the start for a series that never ran",
          { startDate: "2026-01-01" },
          null,
          "2026-03-15",
          ["2026-01-01", "2026-02-01", "2026-03-01"],
        ],
        [
          "only what follows the last booked occurrence",
          {},
          "2026-02-01",
          "2026-04-20",
          ["2026-03-01", "2026-04-01"],
        ],
        [
          "nothing when everything due is booked",
          {},
          "2026-03-01",
          "2026-03-31",
          [],
        ],
        [
          "an occurrence on the very day",
          {},
          "2026-02-01",
          "2026-03-01",
          ["2026-03-01"],
        ],
        [
          "nothing before the start date",
          { startDate: "2026-06-01" },
          null,
          "2026-05-31",
          [],
        ],
        [
          "nothing past the end date",
          { endDate: "2026-02-15" },
          "2026-01-01",
          "2026-12-31",
          ["2026-02-01"],
        ],
        [
          "the series that follows the last booking even after the rule moved",
          { dayOfMonth: 15, startDate: "2026-01-15" },
          "2026-01-01",
          "2026-03-20",
          ["2026-01-15", "2026-02-15", "2026-03-15"],
        ],
      ],
    )("%s", (_name, over, last, today, expected) => {
      expect(dueOccurrences(rule(over), last, today)).toEqual(expected);
    });

    it("has one cap for a run, the one the server books by and the form warns about", () => {
      expect(RECURRENCE_BOOKING_CAP).toBe(120);
    });

    it("is cut at the cap, oldest first", () => {
      expect(
        dueOccurrences(
          rule({ startDate: "2020-01-01" }),
          null,
          "2026-01-01",
          3,
        ),
      ).toEqual(["2020-01-01", "2020-02-01", "2020-03-01"]);
    });
  });

  it("is a function of the date alone, so the nights the clocks change do not matter", () => {
    const r = rule({ startDate: "2026-03-01", dayOfMonth: 29 });
    // 2026-03-29 and 2026-10-25 are the nights Europe/Zurich changes its clocks.
    expect(nextOccurrenceOnOrAfter(r, "2026-03-29")).toBe("2026-03-29");
    expect(nextOccurrenceAfter(r, "2026-03-28")).toBe("2026-03-29");
    expect(nextOccurrenceAfter(r, "2026-03-29")).toBe("2026-04-29");
    expect(occurrencesBetween(r, "2026-10-01", "2026-11-30")).toEqual([
      "2026-10-29",
      "2026-11-29",
    ]);
    const october = rule({ startDate: "2026-10-01", dayOfMonth: 25 });
    expect(occurrencesBetween(october, "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-25",
    ]);
  });
});
