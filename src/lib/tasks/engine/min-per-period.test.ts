import { describe, expect, it } from "vitest";
import { periodBounds } from "./min-per-period";
import { done, evaluate, skipped, trigger } from "./testing";
import type { Completion } from "./types";

const mpp = trigger.minPerPeriod;

describe("periodBounds", () => {
  it.each([
    ["week", "2026-10-06", "2026-10-05", "2026-10-11"],
    ["week", "2026-10-05", "2026-10-05", "2026-10-11"],
    ["week", "2026-10-11", "2026-10-05", "2026-10-11"],
    ["week", "2026-12-31", "2026-12-28", "2027-01-03"],
    ["week", "2027-01-01", "2026-12-28", "2027-01-03"],
    ["week", "2025-01-01", "2024-12-30", "2025-01-05"],
    ["month", "2026-02-10", "2026-02-01", "2026-02-28"],
    ["month", "2028-02-10", "2028-02-01", "2028-02-29"],
    ["month", "2026-12-31", "2026-12-01", "2026-12-31"],
    ["quarter", "2026-02-10", "2026-01-01", "2026-03-31"],
    ["quarter", "2026-04-01", "2026-04-01", "2026-06-30"],
    ["quarter", "2026-12-31", "2026-10-01", "2026-12-31"],
    ["year", "2028-06-01", "2028-01-01", "2028-12-31"],
  ] as const)("%s of %s", (period, date, start, end) => {
    expect(periodBounds(period, date)).toEqual({ start, end });
  });
});

describe("min_per_period, unsatisfied", () => {
  type Row = [
    string,
    Parameters<typeof mpp>[0],
    Completion[],
    string,
    string,
    string,
    string,
    number,
  ];
  const rows: Row[] = [
    [
      "week, Monday, nothing done",
      { period: "week", count: 2 },
      [],
      "2026-10-05",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, Tuesday",
      { period: "week", count: 2 },
      [],
      "2026-10-06",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, Thursday is still before 60%",
      { period: "week", count: 2 },
      [],
      "2026-10-08",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, Friday reaches 60% (floor(4.2) = 4 days)",
      { period: "week", count: 2 },
      [],
      "2026-10-09",
      "due",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, Sunday is the last day and never overdue",
      { period: "week", count: 2 },
      [],
      "2026-10-11",
      "due",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, one of two done",
      { period: "week", count: 2 },
      [done("2026-10-06")],
      "2026-10-06",
      "open",
      "2026-10-05",
      "2026-10-11",
      1,
    ],
    [
      "week, skipped does not count",
      { period: "week", count: 2 },
      [done("2026-10-06"), skipped("2026-10-07")],
      "2026-10-09",
      "due",
      "2026-10-05",
      "2026-10-11",
      1,
    ],
    [
      "week, completion of the previous week does not count",
      { period: "week", count: 1 },
      [done("2026-10-04")],
      "2026-10-05",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week, completion of the next week is ignored",
      { period: "week", count: 1 },
      [done("2026-10-12")],
      "2026-10-06",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "week across the year boundary: Thursday is before Friday Jan 1",
      { period: "week", count: 1 },
      [done("2026-12-27")],
      "2026-12-31",
      "open",
      "2026-12-28",
      "2027-01-03",
      0,
    ],
    [
      "week across the year boundary: Friday of the same week",
      { period: "week", count: 2 },
      [done("2026-12-29")],
      "2027-01-01",
      "due",
      "2026-12-28",
      "2027-01-03",
      1,
    ],
    [
      "week 1 of 2025 starts in 2024",
      { period: "week", count: 1 },
      [done("2024-12-29")],
      "2025-01-01",
      "open",
      "2024-12-30",
      "2025-01-05",
      0,
    ],
    [
      "month, first day",
      { period: "month", count: 1 },
      [],
      "2026-10-01",
      "open",
      "2026-10-01",
      "2026-10-31",
      0,
    ],
    [
      "month, 18th is before 60% of 31 days (floor(18.6) = 18)",
      { period: "month", count: 1 },
      [],
      "2026-10-18",
      "open",
      "2026-10-01",
      "2026-10-31",
      0,
    ],
    [
      "month, 19th reaches 60%",
      { period: "month", count: 1 },
      [],
      "2026-10-19",
      "due",
      "2026-10-01",
      "2026-10-31",
      0,
    ],
    [
      "month, last day",
      { period: "month", count: 1 },
      [],
      "2026-10-31",
      "due",
      "2026-10-01",
      "2026-10-31",
      0,
    ],
    [
      "February 2026, 16th",
      { period: "month", count: 1 },
      [],
      "2026-02-16",
      "open",
      "2026-02-01",
      "2026-02-28",
      0,
    ],
    [
      "February 2026, 17th",
      { period: "month", count: 1 },
      [],
      "2026-02-17",
      "due",
      "2026-02-01",
      "2026-02-28",
      0,
    ],
    [
      "February 2028 (leap), 17th",
      { period: "month", count: 1 },
      [],
      "2028-02-17",
      "open",
      "2028-02-01",
      "2028-02-29",
      0,
    ],
    [
      "February 2028 (leap), 18th",
      { period: "month", count: 1 },
      [],
      "2028-02-18",
      "due",
      "2028-02-01",
      "2028-02-29",
      0,
    ],
    [
      "month, 3 of 4 done",
      { period: "month", count: 4 },
      [
        done("2026-10-01"),
        done("2026-10-02"),
        done("2026-10-02", { time: "18:00" }),
      ],
      "2026-10-20",
      "due",
      "2026-10-01",
      "2026-10-31",
      3,
    ],
    [
      "month, last day of the previous month does not count",
      { period: "month", count: 1 },
      [done("2026-09-30")],
      "2026-10-01",
      "open",
      "2026-10-01",
      "2026-10-31",
      0,
    ],
    [
      "quarter, Q4 Nov 24 still open",
      { period: "quarter", count: 1 },
      [],
      "2026-11-24",
      "open",
      "2026-10-01",
      "2026-12-31",
      0,
    ],
    [
      "quarter, Q4 Nov 25 due (floor(55.2) = 55 days after Oct 1)",
      { period: "quarter", count: 1 },
      [],
      "2026-11-25",
      "due",
      "2026-10-01",
      "2026-12-31",
      0,
    ],
    [
      "quarter, Q1 (90 days)",
      { period: "quarter", count: 1 },
      [],
      "2026-02-24",
      "due",
      "2026-01-01",
      "2026-03-31",
      0,
    ],
    [
      "quarter, last day of March",
      { period: "quarter", count: 2 },
      [done("2026-03-31")],
      "2026-03-31",
      "due",
      "2026-01-01",
      "2026-03-31",
      1,
    ],
    [
      "quarter, first day of April starts a new count",
      { period: "quarter", count: 1 },
      [done("2026-03-31")],
      "2026-04-01",
      "open",
      "2026-04-01",
      "2026-06-30",
      0,
    ],
    [
      "year, mid year",
      { period: "year", count: 1 },
      [],
      "2026-06-01",
      "open",
      "2026-01-01",
      "2026-12-31",
      0,
    ],
    [
      "year, day 219 (Aug 8) reaches 60%",
      { period: "year", count: 1 },
      [],
      "2026-08-08",
      "due",
      "2026-01-01",
      "2026-12-31",
      0,
    ],
    [
      "year, the day before",
      { period: "year", count: 1 },
      [],
      "2026-08-07",
      "open",
      "2026-01-01",
      "2026-12-31",
      0,
    ],
    [
      "leap year, Aug 7 reaches 60% of 366",
      { period: "year", count: 1 },
      [],
      "2028-08-07",
      "due",
      "2028-01-01",
      "2028-12-31",
      0,
    ],
    [
      "custom fraction 0.5 on a week reaches Thursday",
      { period: "week", count: 1, remindFromFraction: 0.5 },
      [],
      "2026-10-08",
      "due",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "custom fraction 0.5 on a week, Wednesday",
      { period: "week", count: 1, remindFromFraction: 0.5 },
      [],
      "2026-10-07",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "fraction 0 is due from the first day",
      { period: "week", count: 1, remindFromFraction: 0 },
      [],
      "2026-10-05",
      "due",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
    [
      "fraction 1 never reaches due",
      { period: "week", count: 1, remindFromFraction: 1 },
      [],
      "2026-10-11",
      "open",
      "2026-10-05",
      "2026-10-11",
      0,
    ],
  ];

  it.each(rows)(
    "%s",
    (_name, t, completions, today, status, windowStart, dueDate, current) => {
      const result = evaluate(mpp(t), today, { completions });
      expect(result.status).toBe(status);
      expect(result.dueKind).toBe("deadline");
      expect(result.dueDate).toBe(dueDate);
      expect(result.windowStart).toBe(windowStart);
      expect(result.occurrenceKey).toBe(`p:${windowStart}`);
      expect(result.progress).toEqual({ current, target: t.count });
    },
  );
});

describe("min_per_period, satisfied", () => {
  it.each([
    [
      "week",
      { period: "week", count: 2 },
      [done("2026-10-05"), done("2026-10-06")],
      "2026-10-06",
      "2026-10-12",
      "2026-10-18",
    ],
    [
      "week, done on the last day",
      { period: "week", count: 1 },
      [done("2026-10-11")],
      "2026-10-11",
      "2026-10-12",
      "2026-10-18",
    ],
    [
      "week across the year boundary",
      { period: "week", count: 1 },
      [done("2027-01-02")],
      "2027-01-03",
      "2027-01-04",
      "2027-01-10",
    ],
    [
      "month",
      { period: "month", count: 1 },
      [done("2026-10-01")],
      "2026-10-31",
      "2026-11-01",
      "2026-11-30",
    ],
    [
      "month before a short February",
      { period: "month", count: 1 },
      [done("2026-01-31")],
      "2026-01-31",
      "2026-02-01",
      "2026-02-28",
    ],
    [
      "month before a leap February",
      { period: "month", count: 1 },
      [done("2028-01-10")],
      "2028-01-31",
      "2028-02-01",
      "2028-02-29",
    ],
    [
      "quarter",
      { period: "quarter", count: 2 },
      [done("2026-10-01"), done("2026-12-31")],
      "2026-12-31",
      "2027-01-01",
      "2027-03-31",
    ],
    [
      "year",
      { period: "year", count: 1 },
      [done("2026-02-01")],
      "2026-10-06",
      "2027-01-01",
      "2027-12-31",
    ],
    [
      "year before a leap year",
      { period: "year", count: 1 },
      [done("2027-02-01")],
      "2027-10-06",
      "2028-01-01",
      "2028-12-31",
    ],
    [
      "more than needed",
      { period: "week", count: 1 },
      [done("2026-10-05"), done("2026-10-06")],
      "2026-10-07",
      "2026-10-12",
      "2026-10-18",
    ],
  ] as const)("%s", (_name, t, completions, today, nextStart, nextEnd) => {
    const result = evaluate(mpp({ ...t }), today, {
      completions: [...completions],
    });
    expect(result.status).toBe("ok");
    expect(result.dueKind).toBe("deadline");
    expect(result.windowStart).toBe(nextStart);
    expect(result.dueDate).toBe(nextEnd);
    expect(result.occurrenceKey).toBe(`p:${nextStart}`);
    expect(result.progress).toBeUndefined();
    expect(result.reasons).toContain("period_satisfied");
  });

  it("skipped completions do not satisfy", () => {
    const result = evaluate(mpp({ period: "week", count: 1 }), "2026-10-09", {
      completions: [skipped("2026-10-06")],
    });
    expect(result.status).toBe("due");
    expect(result.reasons).not.toContain("period_satisfied");
  });
});

describe("min_per_period, missed previous period", () => {
  const t = mpp({ period: "month", count: 2, startDate: "2026-01-01" });
  it.each([
    ["previous month empty", [], true],
    ["previous month one of two", [done("2026-09-10")], true],
    [
      "previous month complete",
      [done("2026-09-10"), done("2026-09-20")],
      false,
    ],
    [
      "previous month complete, skipped ignored",
      [done("2026-09-10"), skipped("2026-09-20")],
      true,
    ],
    [
      "completions of this month do not help",
      [done("2026-10-01"), done("2026-10-02")],
      true,
    ],
  ])("%s", (_name, completions, missed) => {
    const result = evaluate(t, "2026-10-03", { completions });
    expect(result.reasons.includes("missed_previous_period")).toBe(missed);
  });

  it("is also reported when the current period is satisfied", () => {
    const result = evaluate(t, "2026-10-03", {
      completions: [done("2026-10-01"), done("2026-10-02")],
    });
    expect(result.status).toBe("ok");
    expect(result.reasons).toEqual([
      "missed_previous_period",
      "period_satisfied",
    ]);
  });

  it.each([
    ["no start date", undefined, false],
    ["started well before", "2026-01-01", true],
    ["started on the first day of the previous period", "2026-09-01", true],
    ["started during the previous period", "2026-09-02", false],
    ["started this period", "2026-10-01", false],
    ["starts in the future", "2027-01-01", false],
  ])("task existed check: %s", (_name, startDate, missed) => {
    const result = evaluate(
      mpp({ period: "month", count: 1, ...(startDate ? { startDate } : {}) }),
      "2026-10-03",
    );
    expect(result.reasons.includes("missed_previous_period")).toBe(missed);
  });

  it("previous week across the year boundary", () => {
    const week = mpp({ period: "week", count: 1, startDate: "2026-01-01" });
    expect(
      evaluate(week, "2027-01-05", { completions: [done("2027-01-03")] })
        .reasons,
    ).not.toContain("missed_previous_period");
    expect(
      evaluate(week, "2027-01-05", { completions: [done("2026-12-27")] })
        .reasons,
    ).toContain("missed_previous_period");
  });

  it("previous quarter and year", () => {
    expect(
      evaluate(
        mpp({ period: "quarter", count: 1, startDate: "2025-01-01" }),
        "2026-01-02",
      ).reasons,
    ).toContain("missed_previous_period");
    expect(
      evaluate(
        mpp({ period: "year", count: 1, startDate: "2025-01-01" }),
        "2026-03-01",
        {
          completions: [done("2025-12-31")],
        },
      ).reasons,
    ).not.toContain("missed_previous_period");
  });
});
