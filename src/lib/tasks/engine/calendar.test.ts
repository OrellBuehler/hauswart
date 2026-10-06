import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffDays,
  isoWeekStart,
  isValidDate,
  parseDate,
  weekday,
} from "$lib/dates";
import { calendarOccurrences } from "./calendar";
import { done, evaluate, skipped, trigger } from "./testing";
import type { Completion } from "./types";

const cal = trigger.calendar;

type Row = [
  string,
  Parameters<typeof cal>[0],
  Completion[],
  string,
  string,
  string,
  (number | undefined)?,
];

function check(rows: Row[]) {
  it.each(rows)(
    "%s",
    (_name, t, completions, today, dueDate, status, missedCount) => {
      const result = evaluate(cal(t), today, { completions });
      expect(result.dueDate).toBe(dueDate);
      expect(result.status).toBe(status);
      expect(result.occurrenceKey).toBe(dueDate);
      expect(result.dueKind).toBe("exact");
      expect(result.missedCount).toBe(missedCount);
    },
  );
}

const monThu = {
  freq: "weekly" as const,
  interval: 1,
  byWeekday: [1, 4],
  startDate: "2026-10-01",
};
const monthly2ndTue = {
  freq: "monthly" as const,
  interval: 1,
  byWeekday: [2],
  nth: 2,
  startDate: "2026-01-01",
};
const mondays = {
  freq: "weekly" as const,
  interval: 1,
  byWeekday: [1],
  startDate: "2026-01-05",
};

describe("calendar, weekly", () => {
  check([
    [
      "never completed: first occurrence is overdue",
      monThu,
      [],
      "2026-10-06",
      "2026-10-01",
      "overdue",
    ],
    [
      "occurrence done on the day, next one is due",
      monThu,
      [done("2026-10-01")],
      "2026-10-05",
      "2026-10-05",
      "due",
    ],
    [
      "the day after the next one is overdue",
      monThu,
      [done("2026-10-01")],
      "2026-10-06",
      "2026-10-05",
      "overdue",
    ],
    [
      "early completion on Sunday satisfies Monday",
      monThu,
      [done("2026-10-01"), done("2026-10-04")],
      "2026-10-05",
      "2026-10-08",
      "open",
    ],
    [
      "completion on Saturday still belongs to Thursday (early window 1 day)",
      monThu,
      [done("2026-10-03")],
      "2026-10-05",
      "2026-10-05",
      "due",
    ],
    [
      "a skipped occurrence is satisfied",
      monThu,
      [skipped("2026-10-01"), skipped("2026-10-05")],
      "2026-10-05",
      "2026-10-08",
      "open",
    ],
    [
      "multiple completions on the same day",
      monThu,
      [
        done("2026-10-01", { time: "08:00" }),
        done("2026-10-01", { time: "09:00" }),
      ],
      "2026-10-02",
      "2026-10-05",
      "open",
    ],
    [
      "start date in the future",
      { ...monThu, startDate: "2026-10-12" },
      [],
      "2026-10-01",
      "2026-10-12",
      "ok",
    ],
    [
      "the first occurrence respects the start date inside the week",
      { ...monThu, startDate: "2026-10-02" },
      [],
      "2026-09-30",
      "2026-10-05",
      "open",
    ],
    [
      "start date on the occurrence day",
      { ...monThu, startDate: "2026-10-05" },
      [],
      "2026-10-05",
      "2026-10-05",
      "due",
    ],
    [
      "default weekday is the start date weekday",
      { freq: "weekly", interval: 1, startDate: "2026-10-07" },
      [],
      "2026-10-07",
      "2026-10-07",
      "due",
    ],
    [
      "every second Tuesday with a 7 day early window",
      { freq: "weekly", interval: 2, byWeekday: [2], startDate: "2026-10-06" },
      [done("2026-10-06"), done("2026-10-14")],
      "2026-10-15",
      "2026-11-03",
      "ok",
    ],
    [
      "every second Tuesday: just outside the early window",
      { freq: "weekly", interval: 2, byWeekday: [2], startDate: "2026-10-06" },
      [done("2026-10-06"), done("2026-10-12")],
      "2026-10-13",
      "2026-10-20",
      "open",
    ],
    [
      "every second Tuesday: skipped week between",
      { freq: "weekly", interval: 2, byWeekday: [2], startDate: "2026-10-06" },
      [done("2026-10-06")],
      "2026-10-13",
      "2026-10-20",
      "open",
    ],
    [
      "Sunday on the spring DST day",
      { freq: "weekly", interval: 1, byWeekday: [7], startDate: "2026-03-22" },
      [done("2026-03-22")],
      "2026-03-28",
      "2026-03-29",
      "open",
    ],
    [
      "Sunday on the spring DST day, done",
      { freq: "weekly", interval: 1, byWeekday: [7], startDate: "2026-03-22" },
      [done("2026-03-22"), done("2026-03-29")],
      "2026-03-29",
      "2026-04-05",
      "open",
    ],
    [
      "Sunday on the autumn DST day",
      { freq: "weekly", interval: 1, byWeekday: [7], startDate: "2026-10-18" },
      [done("2026-10-18")],
      "2026-10-25",
      "2026-10-25",
      "due",
    ],
    [
      "across the year boundary",
      { freq: "weekly", interval: 1, byWeekday: [4], startDate: "2026-12-24" },
      [done("2026-12-24"), done("2026-12-31")],
      "2027-01-01",
      "2027-01-07",
      "open",
    ],
    [
      "Monday to Friday, no early window",
      {
        freq: "weekly",
        interval: 1,
        byWeekday: [1, 2, 3, 4, 5],
        startDate: "2026-10-05",
      },
      [done("2026-10-05"), done("2026-10-06")],
      "2026-10-07",
      "2026-10-07",
      "due",
    ],
    [
      "Monday to Friday: yesterday's completion does not pre-satisfy today",
      {
        freq: "weekly",
        interval: 1,
        byWeekday: [1, 2, 3, 4, 5],
        startDate: "2026-10-05",
      },
      [done("2026-10-05"), done("2026-10-06")],
      "2026-10-06",
      "2026-10-07",
      "open",
    ],
    [
      "weekly with a month filter skips the off season",
      {
        freq: "weekly",
        interval: 1,
        byWeekday: [1],
        byMonth: [4, 5, 6, 7, 8, 9],
        startDate: "2026-01-01",
      },
      [done("2026-09-21"), done("2026-09-28")],
      "2026-10-06",
      "2027-04-05",
      "ok",
      24,
    ],
  ]);

  it("lookback: oldest unsatisfied within 3 weeks, older ones are only counted", () => {
    const result = evaluate(cal(mondays), "2026-10-06");
    expect(result.dueDate).toBe("2026-09-21");
    expect(result.missedCount).toBe(37);
    expect(result.reasons).toContain("missed_occurrences");
    expect(result.status).toBe("overdue");
  });

  check([
    [
      "explicit key satisfies the surfaced occurrence, the next one is surfaced",
      mondays,
      [done("2026-10-06", { occurrenceKey: "2026-09-21" })],
      "2026-10-06",
      "2026-09-28",
      "overdue",
      37,
    ],
    [
      "a keyless completion today satisfies today's window only",
      mondays,
      [done("2026-10-06")],
      "2026-10-06",
      "2026-09-21",
      "overdue",
      37,
    ],
    [
      "all recent occurrences satisfied: missed ones remain counted",
      mondays,
      [done("2026-09-21"), done("2026-09-28"), done("2026-10-05")],
      "2026-10-06",
      "2026-10-12",
      "open",
      37,
    ],
    [
      "occurrence exactly at the lookback start is still surfaced",
      mondays,
      [],
      "2026-10-05",
      "2026-09-14",
      "overdue",
      36,
    ],
    [
      "no completions, backlog is not larger than the lookback",
      { ...mondays, startDate: "2026-09-21" },
      [],
      "2026-10-06",
      "2026-09-21",
      "overdue",
    ],
  ]);
});

describe("calendar, monthly", () => {
  check([
    [
      "2nd Tuesday: last three occurrences done, older ones only counted",
      monthly2ndTue,
      [done("2026-07-14"), done("2026-08-11"), done("2026-09-08")],
      "2026-10-06",
      "2026-10-13",
      "open",
      6,
    ],
    [
      "2nd Tuesday: nothing done surfaces the oldest in the lookback",
      monthly2ndTue,
      [],
      "2026-10-06",
      "2026-07-14",
      "overdue",
      6,
    ],
    [
      "2nd Tuesday: on the day",
      { ...monthly2ndTue, startDate: "2026-09-01" },
      [done("2026-09-08")],
      "2026-10-13",
      "2026-10-13",
      "due",
    ],
    [
      "2nd Tuesday: completion 8 days early counts for the previous occurrence only",
      { ...monthly2ndTue, startDate: "2026-09-01" },
      [done("2026-10-05")],
      "2026-10-06",
      "2026-10-13",
      "open",
    ],
    [
      "2nd Tuesday: completion 7 days early satisfies the next",
      { ...monthly2ndTue, startDate: "2026-09-01" },
      [done("2026-09-08"), done("2026-10-06")],
      "2026-10-06",
      "2026-11-10",
      "ok",
    ],
    [
      "2nd Tuesday and 2nd Thursday",
      {
        freq: "monthly",
        interval: 1,
        byWeekday: [2, 4],
        nth: 2,
        startDate: "2026-10-01",
      },
      [],
      "2026-10-07",
      "2026-10-08",
      "open",
    ],
    [
      "2nd Tuesday and 2nd Thursday: second one after the first",
      {
        freq: "monthly",
        interval: 1,
        byWeekday: [2, 4],
        nth: 2,
        startDate: "2026-10-01",
      },
      [done("2026-10-08")],
      "2026-10-09",
      "2026-10-13",
      "open",
    ],
    [
      "last Friday of the month",
      {
        freq: "monthly",
        interval: 1,
        byWeekday: [5],
        nth: -1,
        startDate: "2026-10-01",
      },
      [],
      "2026-10-06",
      "2026-10-30",
      "ok",
    ],
    [
      "last Friday: February in 2028 is the 25th",
      {
        freq: "monthly",
        interval: 1,
        byWeekday: [5],
        nth: -1,
        startDate: "2028-02-01",
      },
      [],
      "2028-02-01",
      "2028-02-25",
      "ok",
    ],
    [
      "5th Monday does not exist in every month",
      {
        freq: "monthly",
        interval: 1,
        byWeekday: [1],
        nth: 5,
        startDate: "2026-10-01",
      },
      [],
      "2026-10-06",
      "2026-11-30",
      "ok",
    ],
    [
      "nth without weekday uses the start date weekday",
      { freq: "monthly", interval: 1, nth: 1, startDate: "2026-10-07" },
      [],
      "2026-10-07",
      "2026-10-07",
      "due",
    ],
    [
      "last day of the month",
      { freq: "monthly", interval: 1, byMonthDay: -1, startDate: "2026-02-01" },
      [],
      "2026-02-10",
      "2026-02-28",
      "ok",
    ],
    [
      "last day of the month in a leap year",
      { freq: "monthly", interval: 1, byMonthDay: -1, startDate: "2028-02-01" },
      [],
      "2028-02-10",
      "2028-02-29",
      "ok",
    ],
    [
      "last day: next after Jan 31",
      { freq: "monthly", interval: 1, byMonthDay: -1, startDate: "2026-01-15" },
      [done("2026-01-31")],
      "2026-02-01",
      "2026-02-28",
      "ok",
    ],
    [
      "last day: 30 day month",
      { freq: "monthly", interval: 1, byMonthDay: -1, startDate: "2026-04-01" },
      [],
      "2026-04-23",
      "2026-04-30",
      "open",
    ],
    [
      "second to last day",
      { freq: "monthly", interval: 1, byMonthDay: -2, startDate: "2026-02-01" },
      [],
      "2026-02-01",
      "2026-02-27",
      "ok",
    ],
    [
      "day 31 clamps to February 28",
      { freq: "monthly", interval: 1, byMonthDay: 31, startDate: "2026-02-01" },
      [],
      "2026-02-01",
      "2026-02-28",
      "ok",
    ],
    [
      "day 31 clamps to April 30",
      { freq: "monthly", interval: 1, byMonthDay: 31, startDate: "2026-04-01" },
      [],
      "2026-04-01",
      "2026-04-30",
      "ok",
    ],
    [
      "day 30 clamps to leap day",
      { freq: "monthly", interval: 1, byMonthDay: 30, startDate: "2028-02-01" },
      [],
      "2028-02-01",
      "2028-02-29",
      "ok",
    ],
    [
      "day defaults to the start date day (31st clamps)",
      { freq: "monthly", interval: 1, startDate: "2026-01-31" },
      [done("2026-01-31")],
      "2026-02-01",
      "2026-02-28",
      "ok",
    ],
    [
      "day defaults to the start date day: March is the 31st again",
      { freq: "monthly", interval: 1, startDate: "2026-01-31" },
      [done("2026-01-31"), done("2026-02-28")],
      "2026-03-01",
      "2026-03-31",
      "ok",
    ],
    [
      "15th: 8 days early counts for the previous occurrence only",
      { freq: "monthly", interval: 1, byMonthDay: 15, startDate: "2026-09-15" },
      [done("2026-10-07")],
      "2026-10-07",
      "2026-10-15",
      "ok",
    ],
    [
      "15th: 7 days early satisfies the next",
      { freq: "monthly", interval: 1, byMonthDay: 15, startDate: "2026-09-15" },
      [done("2026-09-15"), done("2026-10-08")],
      "2026-10-08",
      "2026-11-15",
      "ok",
    ],
    [
      "15th with earlyDays 0 requires the day itself",
      {
        freq: "monthly",
        interval: 1,
        byMonthDay: 15,
        startDate: "2026-09-15",
        earlyDays: 0,
      },
      [done("2026-09-15"), done("2026-10-14")],
      "2026-10-14",
      "2026-10-15",
      "open",
    ],
    [
      "15th with earlyDays 10",
      {
        freq: "monthly",
        interval: 1,
        byMonthDay: 15,
        startDate: "2026-09-15",
        earlyDays: 10,
      },
      [done("2026-09-15"), done("2026-10-05")],
      "2026-10-05",
      "2026-11-15",
      "ok",
    ],
    [
      "quarterly on the 1st",
      { freq: "monthly", interval: 3, byMonthDay: 1, startDate: "2026-01-01" },
      [done("2026-04-01"), done("2026-07-01"), done("2026-10-01")],
      "2026-10-06",
      "2027-01-01",
      "ok",
      1,
    ],
    [
      "month filter Apr-Sep skips the winter",
      {
        freq: "monthly",
        interval: 1,
        byMonthDay: 1,
        byMonth: [4, 5, 6, 7, 8, 9],
        startDate: "2026-01-01",
      },
      [
        done("2026-04-01"),
        done("2026-05-01"),
        done("2026-06-01"),
        done("2026-07-01"),
        done("2026-08-01"),
        done("2026-09-01"),
      ],
      "2026-10-06",
      "2027-04-01",
      "ok",
    ],
    [
      "start date after the day in the first month",
      { freq: "monthly", interval: 1, byMonthDay: 5, startDate: "2026-10-06" },
      [],
      "2026-10-06",
      "2026-11-05",
      "ok",
    ],
  ]);

  it("no occurrence within the search horizon yields unknown", () => {
    const t = cal({
      freq: "monthly",
      interval: 1,
      byWeekday: [1],
      nth: 5,
      byMonth: [2],
      startDate: "2026-01-01",
    });
    const result = evaluate(t, "2026-10-06");
    expect(result.status).toBe("unknown");
    expect(result.dueDate).toBeNull();
    expect(result.reasons).toEqual(["no_occurrences"]);
  });
});

describe("calendar, yearly", () => {
  check([
    [
      "two months a year",
      {
        freq: "yearly",
        interval: 1,
        byMonth: [3, 9],
        byMonthDay: 15,
        startDate: "2026-01-01",
      },
      [done("2026-03-15"), done("2026-09-15")],
      "2026-10-06",
      "2027-03-15",
      "ok",
    ],
    [
      "two months a year, second not done yet",
      {
        freq: "yearly",
        interval: 1,
        byMonth: [3, 9],
        byMonthDay: 15,
        startDate: "2026-01-01",
      },
      [done("2026-03-15")],
      "2026-09-10",
      "2026-09-15",
      "open",
    ],
    [
      "Feb 29 start falls back to Feb 28",
      { freq: "yearly", interval: 1, startDate: "2028-02-29" },
      [done("2028-02-29")],
      "2029-01-01",
      "2029-02-28",
      "ok",
    ],
    [
      "Feb 29 start returns on the next leap day",
      { freq: "yearly", interval: 4, startDate: "2028-02-29" },
      [done("2028-02-29")],
      "2029-01-01",
      "2032-02-29",
      "ok",
    ],
    [
      "fourth Thursday of November",
      {
        freq: "yearly",
        interval: 1,
        byMonth: [11],
        byWeekday: [4],
        nth: 4,
        startDate: "2026-01-01",
      },
      [],
      "2026-10-06",
      "2026-11-26",
      "ok",
    ],
    [
      "every second year",
      {
        freq: "yearly",
        interval: 2,
        byMonth: [6],
        byMonthDay: 1,
        startDate: "2026-01-01",
      },
      [done("2026-06-01")],
      "2026-10-06",
      "2028-06-01",
      "ok",
    ],
    [
      "yearly on the last day of February",
      {
        freq: "yearly",
        interval: 1,
        byMonth: [2],
        byMonthDay: -1,
        startDate: "2027-01-01",
      },
      [],
      "2027-01-01",
      "2027-02-28",
      "ok",
    ],
    [
      "yearly defaults to the start date",
      { freq: "yearly", interval: 1, startDate: "2026-10-06" },
      [],
      "2026-10-06",
      "2026-10-06",
      "due",
    ],
    [
      "yearly: a completion 7 days early satisfies the next year",
      { freq: "yearly", interval: 1, startDate: "2025-10-06" },
      [done("2025-10-06"), done("2026-09-29")],
      "2026-09-29",
      "2027-10-06",
      "ok",
    ],
    [
      "yearly with the lookback of 3 years",
      { freq: "yearly", interval: 1, startDate: "2020-03-01" },
      [],
      "2026-10-06",
      "2024-03-01",
      "overdue",
      4,
    ],
  ]);
});

describe("calendarOccurrences", () => {
  it("lists occurrences in a range", () => {
    expect(
      calendarOccurrences(
        cal({
          freq: "monthly",
          interval: 1,
          byMonthDay: -1,
          startDate: "2027-06-01",
        }),
        "2028-01-01",
        "2028-04-30",
      ),
    ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });

  it("never lists dates before the start date", () => {
    expect(
      calendarOccurrences(cal(monThu), "2026-09-01", "2026-10-12"),
    ).toEqual(["2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12"]);
  });

  it("includes Jan 1 occurrences across the year boundary", () => {
    expect(
      calendarOccurrences(
        cal({
          freq: "weekly",
          interval: 1,
          byWeekday: [4, 5],
          startDate: "2026-12-01",
        }),
        "2026-12-30",
        "2027-01-08",
      ),
    ).toEqual(["2026-12-31", "2027-01-01", "2027-01-07", "2027-01-08"]);
  });

  it("every two weeks keeps the phase of the start week", () => {
    expect(
      calendarOccurrences(
        cal({
          freq: "weekly",
          interval: 2,
          byWeekday: [3],
          startDate: "2026-10-07",
        }),
        "2026-10-01",
        "2026-11-30",
      ),
    ).toEqual(["2026-10-07", "2026-10-21", "2026-11-04", "2026-11-18"]);
  });
});

describe("calendar properties", () => {
  let seed = 987654321;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 7) % n;
  };
  const pick = <T>(items: T[]): T => items[rand(items.length)];

  function randomConfig(): Parameters<typeof cal>[0] {
    const startDate = addDays("2025-06-01", rand(500));
    const freq = pick(["weekly", "monthly", "yearly"] as const);
    if (freq === "weekly") {
      const weekdays = [1, 2, 3, 4, 5, 6, 7].filter(() => rand(3) === 0);
      return {
        freq,
        interval: 1 + rand(3),
        ...(weekdays.length ? { byWeekday: weekdays } : {}),
        startDate,
        ...(rand(4) === 0 ? { earlyDays: rand(5) } : {}),
      };
    }
    const dayRule = pick([
      { byMonthDay: -1 },
      { byMonthDay: 1 + rand(31) },
      { byWeekday: [1 + rand(7)], nth: pick([1, 2, 3, 4, -1]) },
      {},
    ]);
    return {
      freq,
      interval: 1 + rand(freq === "yearly" ? 2 : 4),
      ...dayRule,
      ...(freq === "yearly" ? { byMonth: [1 + rand(12)] } : {}),
      startDate,
    };
  }

  function reference(
    t: ReturnType<typeof cal>,
    completions: Completion[],
    today: string,
  ) {
    const occ = calendarOccurrences(t, t.startDate, addDays(today, 800));
    let minGap = Infinity;
    for (let i = 1; i < occ.length; i += 1)
      minGap = Math.min(minGap, diffDays(occ[i], occ[i - 1]));
    const early = t.earlyDays ?? Math.min(7, Math.floor(minGap / 2));
    const sat = occ.map((o, i) =>
      completions.some((c) => {
        if (c.occurrenceKey && occ.includes(c.occurrenceKey))
          return c.occurrenceKey === o;
        const lo = addDays(o, -early);
        const hi =
          i + 1 < occ.length ? addDays(occ[i + 1], -early) : "9999-12-31";
        return c.completedDate >= lo && c.completedDate < hi;
      }),
    );
    const n = LOOKBACK * t.interval;
    const lookbackStart =
      t.freq === "weekly"
        ? addDays(today, -7 * n)
        : t.freq === "monthly"
          ? addMonths(today, -n)
          : addYears(today, -n);
    let missed = 0;
    for (let i = 0; i < occ.length; i += 1) {
      if (sat[i]) continue;
      if (occ[i] < lookbackStart) missed += 1;
      else return { due: occ[i], missed };
    }
    return { due: null, missed };
  }
  const LOOKBACK = 3;

  it("matches a naive reference over random configurations", () => {
    for (let i = 0; i < 400; i += 1) {
      const config = randomConfig();
      const t = cal(config);
      const today = addDays(t.startDate, rand(900) - 30);
      const completions: Completion[] = [];
      const occ = calendarOccurrences(t, t.startDate, addDays(today, 60));
      for (let j = rand(6); j > 0; j -= 1) {
        const date = addDays(today, -rand(400));
        const key = occ.length && rand(3) === 0 ? pick(occ) : null;
        completions.push(done(date, { occurrenceKey: key, id: `c${j}` }));
      }
      const expected = reference(t, completions, today);
      const actual = evaluate(t, today, { completions });
      const label = JSON.stringify({
        config,
        today,
        completions: completions.map((c) => [c.completedDate, c.occurrenceKey]),
      });
      expect(actual.dueDate, label).toBe(expected.due);
      expect(actual.missedCount ?? 0, label).toBe(expected.missed);
    }
  });

  it("generates well formed occurrences", () => {
    for (let i = 0; i < 300; i += 1) {
      const t = cal(randomConfig());
      const occ = calendarOccurrences(t, t.startDate, addYears(t.startDate, 4));
      expect(occ.length).toBeGreaterThan(0);
      for (let j = 0; j < occ.length; j += 1) {
        const date = occ[j];
        expect(isValidDate(date)).toBe(true);
        expect(date >= t.startDate).toBe(true);
        if (j > 0) expect(date > occ[j - 1]).toBe(true);
        if (t.freq === "weekly") {
          const allowed = t.byWeekday ?? [weekday(t.startDate)];
          expect(allowed).toContain(weekday(date));
          const weeks =
            diffDays(isoWeekStart(date), isoWeekStart(t.startDate)) / 7;
          expect(weeks % t.interval).toBe(0);
        } else {
          const { year, month, day } = parseDate(date);
          const dim = daysInMonth(year, month);
          if (t.nth !== undefined) {
            expect(t.byWeekday ?? [weekday(t.startDate)]).toContain(
              weekday(date),
            );
            if (t.nth > 0) {
              expect(day).toBeGreaterThan(7 * (t.nth - 1));
              expect(day).toBeLessThanOrEqual(7 * t.nth);
            } else {
              expect(day).toBeGreaterThan(dim - 7);
            }
          } else if (t.byMonthDay === -1) {
            expect(day).toBe(dim);
          } else if (t.byMonthDay !== undefined) {
            expect(day).toBe(Math.min(t.byMonthDay, dim));
          } else {
            expect(day).toBe(Math.min(parseDate(t.startDate).day, dim));
          }
          if (t.freq === "monthly") {
            const start = parseDate(t.startDate);
            const months = (year - start.year) * 12 + (month - start.month);
            expect(months % t.interval).toBe(0);
          } else {
            expect((year - parseDate(t.startDate).year) % t.interval).toBe(0);
            expect(t.byMonth ?? [parseDate(t.startDate).month]).toContain(
              month,
            );
          }
        }
      }
    }
  });

  it("the surfaced occurrence always belongs to the occurrence list", () => {
    for (let i = 0; i < 200; i += 1) {
      const t = cal(randomConfig());
      const today = addDays(t.startDate, rand(700));
      const result = evaluate(t, today);
      if (result.status === "unknown") continue;
      expect(result.dueDate).toBe(result.occurrenceKey);
      expect(
        calendarOccurrences(t, t.startDate, addDays(today, 3000)),
      ).toContain(result.dueDate);
    }
  });
});
