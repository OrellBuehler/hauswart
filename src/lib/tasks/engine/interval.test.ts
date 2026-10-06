import { describe, expect, it } from "vitest";
import { addDays, addMonths, addYears, diffDays } from "$lib/dates";
import { addInterval, intervalAt, monthInRange, nextFrom } from "./interval";
import { done, evaluate, skipped, trigger } from "./testing";
import type { Completion, IntervalUnit } from "./types";

const iv = trigger.interval;

describe("interval, completion anchor", () => {
  type Row = [
    string,
    Parameters<typeof iv>[0],
    Completion[],
    string,
    string,
    string,
  ];
  const rows: Row[] = [
    [
      "never completed, start in the past is overdue at start date",
      { every: 2, unit: "week", anchor: "completion", startDate: "2026-10-01" },
      [],
      "2026-10-06",
      "2026-10-01",
      "overdue",
    ],
    [
      "never completed, start today is due",
      { every: 2, unit: "week", anchor: "completion", startDate: "2026-10-06" },
      [],
      "2026-10-06",
      "2026-10-06",
      "due",
    ],
    [
      "never completed, start far in the future is ok",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2027-01-01",
      },
      [],
      "2026-10-06",
      "2027-01-01",
      "ok",
    ],
    [
      "never completed, start within the lead window is open",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2026-10-12",
      },
      [],
      "2026-10-06",
      "2026-10-12",
      "open",
    ],
    [
      "completed on time, days",
      { every: 10, unit: "day", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-10-01")],
      "2026-10-06",
      "2026-10-11",
      "open",
    ],
    [
      "completed long ago, weeks, overdue",
      { every: 2, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-09-01")],
      "2026-10-06",
      "2026-09-15",
      "overdue",
    ],
    [
      "late completion shifts the schedule (drift)",
      { every: 4, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-08-04"), done("2026-09-10")],
      "2026-09-11",
      "2026-10-08",
      "ok",
    ],
    [
      "early completion also moves the due date from the completion",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2026-01-01",
      },
      [done("2026-09-01"), done("2026-09-05")],
      "2026-09-06",
      "2026-10-05",
      "ok",
    ],
    [
      "month end clamps to February 28",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2026-01-01",
      },
      [done("2026-01-31")],
      "2026-02-01",
      "2026-02-28",
      "ok",
    ],
    [
      "month end clamps to leap day in 2028",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2028-01-01",
      },
      [done("2028-01-31")],
      "2028-02-01",
      "2028-02-29",
      "ok",
    ],
    [
      "completion on Feb 28 then adds a month without drift back to the 31st",
      {
        every: 1,
        unit: "month",
        anchor: "completion",
        startDate: "2026-01-01",
      },
      [done("2026-02-28")],
      "2026-03-27",
      "2026-03-28",
      "open",
    ],
    [
      "Feb 29 plus one year is Feb 28",
      { every: 1, unit: "year", anchor: "completion", startDate: "2027-01-01" },
      [done("2028-02-29")],
      "2028-03-01",
      "2029-02-28",
      "ok",
    ],
    [
      "yearly rolls over the year boundary",
      { every: 1, unit: "year", anchor: "completion", startDate: "2020-01-01" },
      [done("2025-12-31")],
      "2026-12-30",
      "2026-12-31",
      "open",
    ],
    [
      "six months across year end",
      {
        every: 6,
        unit: "month",
        anchor: "completion",
        startDate: "2020-01-01",
      },
      [done("2026-08-31")],
      "2026-10-06",
      "2027-02-28",
      "ok",
    ],
    [
      "interval across the spring DST day is plain calendar math",
      { every: 1, unit: "day", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-03-28")],
      "2026-03-28",
      "2026-03-29",
      "open",
    ],
    [
      "one week across the autumn DST day",
      { every: 1, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-10-24")],
      "2026-10-25",
      "2026-10-31",
      "open",
    ],
    [
      "a skipped completion counts for scheduling",
      { every: 2, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-08-01"), skipped("2026-09-20")],
      "2026-09-21",
      "2026-10-04",
      "ok",
    ],
    [
      "several completions on one day behave like one",
      { every: 1, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [
        done("2026-10-01", { time: "08:00" }),
        done("2026-10-01", { time: "20:00" }),
      ],
      "2026-10-02",
      "2026-10-08",
      "open",
    ],
    [
      "the latest completion date wins regardless of order",
      { every: 1, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [done("2026-10-02"), done("2026-09-01"), done("2026-09-20")],
      "2026-10-03",
      "2026-10-09",
      "open",
    ],
    [
      "a back-dated entry logged later does not override a newer completion date",
      { every: 1, unit: "week", anchor: "completion", startDate: "2026-01-01" },
      [
        done("2026-10-02", { time: "09:00" }),
        done("2026-09-25", { time: "23:00" }),
      ],
      "2026-10-03",
      "2026-10-09",
      "open",
    ],
    [
      "a completion before startDate never pulls the due date before startDate",
      { every: 1, unit: "week", anchor: "completion", startDate: "2026-12-01" },
      [done("2026-10-01")],
      "2026-10-06",
      "2026-12-01",
      "ok",
    ],
    [
      "completed today, due in one interval",
      {
        every: 3,
        unit: "month",
        anchor: "completion",
        startDate: "2026-01-01",
      },
      [done("2026-10-06")],
      "2026-10-06",
      "2027-01-06",
      "ok",
    ],
  ];

  it.each(rows)("%s", (_name, t, completions, today, dueDate, status) => {
    const result = evaluate(iv(t), today, { completions });
    expect(result.dueDate).toBe(dueDate);
    expect(result.status).toBe(status);
    expect(result.dueKind).toBe("exact");
    expect(result.occurrenceKey).toBe(dueDate);
  });

  it("reports never_completed only without completions", () => {
    const t = iv({
      every: 1,
      unit: "week",
      anchor: "completion",
      startDate: "2026-10-01",
    });
    expect(evaluate(t, "2026-10-06").reasons).toContain("never_completed");
    expect(
      evaluate(t, "2026-10-06", { completions: [done("2026-10-01")] }).reasons,
    ).not.toContain("never_completed");
  });

  it.each([
    ["on the due day", "2026-10-11", 0, "due"],
    ["one day late without grace", "2026-10-12", 0, "overdue"],
    ["one day late with 1 grace day", "2026-10-12", 1, "due"],
    ["two days late with 1 grace day", "2026-10-13", 1, "overdue"],
    ["seven days before", "2026-10-04", 0, "open"],
    ["eight days before", "2026-10-03", 0, "ok"],
  ])("status %s", (_name, today, graceDays, status) => {
    const t = iv({
      every: 10,
      unit: "day",
      anchor: "completion",
      startDate: "2026-01-01",
    });
    const result = evaluate(t, today, {
      completions: [done("2026-10-01")],
      graceDays,
    });
    expect(result.dueDate).toBe("2026-10-11");
    expect(result.status).toBe(status);
  });

  it("respects a custom dueSoonDays", () => {
    const t = iv({
      every: 10,
      unit: "day",
      anchor: "completion",
      startDate: "2026-01-01",
    });
    const base = { completions: [done("2026-10-01")] };
    expect(evaluate(t, "2026-10-08", { ...base, dueSoonDays: 2 }).status).toBe(
      "ok",
    );
    expect(evaluate(t, "2026-10-09", { ...base, dueSoonDays: 2 }).status).toBe(
      "open",
    );
  });
});

describe("interval, seasons (summer every 3 days Apr-Sep, winter every 10 days Oct-Mar)", () => {
  const seasonal = iv({
    every: 10,
    unit: "day",
    anchor: "completion",
    startDate: "2026-01-01",
    seasons: [
      { fromMonth: 4, toMonth: 9, every: 3, unit: "day" },
      { fromMonth: 10, toMonth: 3, every: 10, unit: "day" },
    ],
  });

  it.each([
    ["mid summer uses 3 days", "2026-06-01", "2026-06-04", false],
    ["mid winter uses 10 days", "2026-12-01", "2026-12-11", false],
    ["winter across the new year", "2026-12-28", "2027-01-07", false],
    ["late winter before the boundary", "2026-03-20", "2026-03-30", false],
    [
      "summer to winter: keeps the earlier summer date",
      "2026-09-29",
      "2026-10-02",
      false,
    ],
    ["summer on the last day", "2026-09-30", "2026-10-03", false],
    [
      "winter to summer: boundary pulls the date in",
      "2026-03-25",
      "2026-04-01",
      true,
    ],
    [
      "winter to summer: new interval lands after the boundary",
      "2026-03-30",
      "2026-04-02",
      true,
    ],
    [
      "winter to summer on the last winter day",
      "2026-03-31",
      "2026-04-03",
      true,
    ],
    [
      "winter to summer: candidate exactly on the boundary day",
      "2026-03-22",
      "2026-04-01",
      false,
    ],
    [
      "winter completion just before it would cross no boundary",
      "2026-03-21",
      "2026-03-31",
      false,
    ],
    ["first day of summer", "2026-04-01", "2026-04-04", false],
    ["first day of winter", "2026-10-01", "2026-10-11", false],
  ])("%s", (_name, completed, expected, boundary) => {
    const result = evaluate(seasonal, completed, {
      completions: [done(completed)],
    });
    expect(result.dueDate).toBe(expected);
    expect(result.reasons.includes("seasonal_boundary")).toBe(boundary);
  });

  it("never completed starts at startDate regardless of season", () => {
    expect(evaluate(seasonal, "2026-02-01").dueDate).toBe("2026-01-01");
  });

  const wrapping = iv({
    every: 3,
    unit: "day",
    anchor: "completion",
    startDate: "2026-01-01",
    seasons: [{ fromMonth: 11, toMonth: 2, every: 10, unit: "day" }],
  });

  it.each([
    [
      "outside the wrapping season falls back to the base interval",
      "2026-10-20",
      "2026-10-23",
    ],
    ["inside, before the new year", "2026-12-25", "2027-01-04"],
    ["inside, after the new year", "2027-01-05", "2027-01-15"],
    [
      "entering the season keeps the shorter base interval",
      "2026-10-30",
      "2026-11-02",
    ],
    [
      "leaving the season in March pulls in to the boundary",
      "2027-02-27",
      "2027-03-02",
    ],
    ["last day of February", "2027-02-28", "2027-03-03"],
  ])("wrapping 11-2: %s", (_name, completed, expected) => {
    const result = evaluate(wrapping, completed, {
      completions: [done(completed)],
    });
    expect(result.dueDate).toBe(expected);
  });

  it("month based seasons", () => {
    const t = iv({
      every: 3,
      unit: "month",
      anchor: "completion",
      startDate: "2026-01-01",
      seasons: [{ fromMonth: 4, toMonth: 9, every: 1, unit: "month" }],
    });
    expect(
      evaluate(t, "2026-03-15", { completions: [done("2026-03-15")] }).dueDate,
    ).toBe("2026-04-15");
    expect(
      evaluate(t, "2026-07-31", { completions: [done("2026-07-31")] }).dueDate,
    ).toBe("2026-08-31");
    expect(
      evaluate(t, "2026-09-30", { completions: [done("2026-09-30")] }).dueDate,
    ).toBe("2026-10-30");
    expect(
      evaluate(t, "2026-11-30", { completions: [done("2026-11-30")] }).dueDate,
    ).toBe("2027-02-28");
  });

  it("a long interval crossing several boundaries takes the earliest re-evaluation", () => {
    const t = iv({
      every: 1,
      unit: "year",
      anchor: "completion",
      startDate: "2026-01-01",
      seasons: [{ fromMonth: 6, toMonth: 8, every: 2, unit: "month" }],
    });
    expect(
      evaluate(t, "2026-01-15", { completions: [done("2026-01-15")] }).dueDate,
    ).toBe("2026-06-01");
    expect(
      evaluate(t, "2026-04-15", { completions: [done("2026-04-15")] }).dueDate,
    ).toBe("2026-06-15");
  });

  it("helpers", () => {
    expect(monthInRange(1, 11, 2)).toBe(true);
    expect(monthInRange(3, 11, 2)).toBe(false);
    expect(monthInRange(11, 11, 2)).toBe(true);
    expect(monthInRange(6, 4, 9)).toBe(true);
    expect(monthInRange(10, 4, 9)).toBe(false);
    expect(intervalAt(seasonal, "2026-05-05")).toMatchObject({ every: 3 });
    expect(intervalAt(seasonal, "2026-11-05")).toMatchObject({ every: 10 });
    expect(nextFrom(seasonal, "2026-06-01").date).toBe("2026-06-04");
    expect(addInterval("2026-01-31", 1, "month")).toBe("2026-02-28");
    expect(addInterval("2026-01-31", 2, "week")).toBe("2026-02-14");
  });
});

describe("interval, schedule anchor", () => {
  type Row = [string, Parameters<typeof iv>[0], Completion[], string, string];
  const weekly = {
    every: 1,
    unit: "week" as const,
    anchor: "schedule" as const,
    startDate: "2026-10-05",
  };
  const monthly = {
    every: 1,
    unit: "month" as const,
    anchor: "schedule" as const,
    startDate: "2026-01-01",
  };
  const rows: Row[] = [
    [
      "never completed is due at the first occurrence",
      weekly,
      [],
      "2026-10-06",
      "2026-10-05",
    ],
    ["future start", weekly, [], "2026-09-01", "2026-10-05"],
    [
      "on-time completion satisfies its occurrence",
      weekly,
      [done("2026-10-05")],
      "2026-10-06",
      "2026-10-12",
    ],
    [
      "a late completion within the window keeps the grid (no drift)",
      weekly,
      [done("2026-10-07")],
      "2026-10-07",
      "2026-10-12",
    ],
    [
      "late up to half a period before the next occurrence",
      weekly,
      [done("2026-10-08")],
      "2026-10-08",
      "2026-10-12",
    ],
    [
      "past the half point it counts for the next occurrence",
      weekly,
      [done("2026-10-09")],
      "2026-10-09",
      "2026-10-19",
    ],
    [
      "early completion inside the early window",
      weekly,
      [done("2026-10-02")],
      "2026-10-02",
      "2026-10-12",
    ],
    [
      "too early completion is ignored",
      weekly,
      [done("2026-10-01")],
      "2026-10-01",
      "2026-10-05",
    ],
    [
      "skipped completion satisfies as well",
      weekly,
      [skipped("2026-10-05")],
      "2026-10-06",
      "2026-10-12",
    ],
    [
      "completions on consecutive weeks",
      weekly,
      [done("2026-10-05"), done("2026-10-12")],
      "2026-10-13",
      "2026-10-19",
    ],
    [
      "a gap in completions: due follows the last satisfied occurrence",
      weekly,
      [done("2026-10-05"), done("2026-10-26")],
      "2026-10-27",
      "2026-11-02",
    ],
    [
      "explicit occurrence key for an old occurrence",
      weekly,
      [done("2026-10-20", { occurrenceKey: "2026-10-05" })],
      "2026-10-20",
      "2026-10-12",
    ],
    [
      "unrelated key falls back to the window",
      weekly,
      [done("2026-10-07", { occurrenceKey: "c:xyz" })],
      "2026-10-07",
      "2026-10-12",
    ],
    [
      "a date key that is not an occurrence falls back to the window",
      weekly,
      [done("2026-10-07", { occurrenceKey: "2026-10-06" })],
      "2026-10-07",
      "2026-10-12",
    ],
    [
      "month end grid has no drift (Jan 31, Feb 28, Mar 31)",
      { ...monthly, startDate: "2026-01-31" },
      [done("2026-02-28")],
      "2026-03-01",
      "2026-03-31",
    ],
    [
      "month end grid, first occurrence done",
      { ...monthly, startDate: "2026-01-31" },
      [done("2026-01-31")],
      "2026-02-01",
      "2026-02-28",
    ],
    [
      "month grid mid period completion",
      monthly,
      [done("2026-02-10")],
      "2026-02-10",
      "2026-03-01",
    ],
    [
      "month grid half period boundary (Feb 15 starts the March window)",
      monthly,
      [done("2026-02-15")],
      "2026-02-15",
      "2026-04-01",
    ],
    [
      "month grid one day before that boundary",
      monthly,
      [done("2026-02-14")],
      "2026-02-14",
      "2026-03-01",
    ],
    [
      "leap year yearly grid",
      {
        every: 1,
        unit: "year" as const,
        anchor: "schedule" as const,
        startDate: "2028-02-29",
      },
      [done("2028-02-29")],
      "2028-03-01",
      "2029-02-28",
    ],
    [
      "leap year yearly grid, 4th year returns to Feb 29",
      {
        every: 4,
        unit: "year" as const,
        anchor: "schedule" as const,
        startDate: "2028-02-29",
      },
      [done("2028-02-29")],
      "2028-03-01",
      "2032-02-29",
    ],
    [
      "every 3 months grid",
      {
        every: 3,
        unit: "month" as const,
        anchor: "schedule" as const,
        startDate: "2026-01-15",
      },
      [done("2026-04-20")],
      "2026-04-21",
      "2026-07-15",
    ],
    [
      "a long forgotten task is cleared by one completion now",
      { ...weekly, startDate: "2026-01-05" },
      [done("2026-10-06")],
      "2026-10-06",
      "2026-10-12",
    ],
    [
      "a long forgotten task without completion is overdue since the start",
      { ...weekly, startDate: "2026-01-05" },
      [],
      "2026-10-06",
      "2026-01-05",
    ],
    [
      "DST day completion keeps the weekly grid",
      { ...weekly, startDate: "2026-03-23" },
      [done("2026-03-29")],
      "2026-03-29",
      "2026-04-06",
    ],
    [
      "autumn DST day completion",
      { ...weekly, startDate: "2026-10-19" },
      [done("2026-10-25")],
      "2026-10-25",
      "2026-11-02",
    ],
    [
      "every 2 days grid",
      {
        every: 2,
        unit: "day" as const,
        anchor: "schedule" as const,
        startDate: "2026-10-01",
      },
      [done("2026-10-04")],
      "2026-10-04",
      "2026-10-07",
    ],
    [
      "every day: the completion window is a single day",
      {
        every: 1,
        unit: "day" as const,
        anchor: "schedule" as const,
        startDate: "2026-10-01",
      },
      [done("2026-10-04")],
      "2026-10-04",
      "2026-10-05",
    ],
    [
      "completion before the whole schedule starts is ignored",
      weekly,
      [done("2026-09-01")],
      "2026-10-06",
      "2026-10-05",
    ],
  ];
  it.each(rows)("%s", (_name, t, completions, today, dueDate) => {
    const result = evaluate(iv(t), today, { completions });
    expect(result.dueDate).toBe(dueDate);
    expect(result.occurrenceKey).toBe(dueDate);
    expect(result.dueKind).toBe("exact");
  });

  it("status follows the due date", () => {
    const t = iv(weekly);
    expect(evaluate(t, "2026-10-05").status).toBe("due");
    expect(evaluate(t, "2026-10-06").status).toBe("overdue");
    expect(evaluate(t, "2026-10-06", { graceDays: 1 }).status).toBe("due");
    expect(evaluate(t, "2026-09-28").status).toBe("open");
    expect(evaluate(t, "2026-09-27").status).toBe("ok");
  });

  describe("seasonal schedule", () => {
    const t = iv({
      every: 10,
      unit: "day",
      anchor: "schedule",
      startDate: "2026-03-20",
      seasons: [{ fromMonth: 4, toMonth: 9, every: 3, unit: "day" }],
    });
    it.each([
      ["no completion", [], "2026-03-20"],
      ["first occurrence done", [done("2026-03-20")], "2026-03-30"],
      [
        "the winter occurrence after Mar 30 is pulled to Apr 2 (new season interval)",
        [done("2026-03-30")],
        "2026-04-02",
      ],
      [
        "summer grid continues every 3 days (Apr 1 falls in the Apr 2 window)",
        [done("2026-04-01")],
        "2026-04-05",
      ],
      ["completion on a summer occurrence", [done("2026-04-05")], "2026-04-08"],
    ])("%s", (_name, completions, expected) => {
      expect(evaluate(t, "2026-04-06", { completions }).dueDate).toBe(expected);
    });
  });
});

describe("interval schedule anchor matches a brute force reference", () => {
  function reference(
    start: string,
    every: number,
    unit: IntervalUnit,
    completions: string[],
  ): string {
    const occ = (k: number) =>
      unit === "day"
        ? addDays(start, k * every)
        : unit === "week"
          ? addDays(start, 7 * k * every)
          : unit === "month"
            ? addMonths(start, k * every)
            : addYears(start, k * every);
    let last = -1;
    for (const c of completions) {
      for (let k = 0; k < 400; k += 1) {
        const prevGap =
          k === 0 ? diffDays(occ(1), occ(0)) : diffDays(occ(k), occ(k - 1));
        const lo = addDays(occ(k), -Math.floor(prevGap / 2));
        if (lo <= c) last = Math.max(last, k);
        else break;
      }
    }
    return occ(last + 1);
  }

  let seed = 12345;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  it("agrees over many random configurations", () => {
    const units: IntervalUnit[] = ["day", "week", "month", "year"];
    for (let i = 0; i < 300; i += 1) {
      const unit = units[rand(4)];
      const every =
        1 +
        rand(
          unit === "day" ? 20 : unit === "week" ? 4 : unit === "month" ? 14 : 3,
        );
      const start = addDays("2024-01-01", rand(900));
      const dates: string[] = [];
      for (let j = rand(4); j > 0; j -= 1)
        dates.push(addDays(start, rand(1200) - 40));
      const t = iv({ every, unit, anchor: "schedule", startDate: start });
      const got = evaluate(t, "2027-01-01", {
        completions: dates.map((d) => done(d)),
      }).dueDate;
      expect(got, `${every} ${unit} from ${start}: ${dates.join(",")}`).toBe(
        reference(start, every, unit, dates),
      );
    }
  });
});
