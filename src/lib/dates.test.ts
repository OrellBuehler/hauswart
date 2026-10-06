import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  dayNumber,
  daysInMonth,
  diffDays,
  formatDate,
  fromDayNumber,
  isLeapYear,
  isoWeek,
  isoWeekEnd,
  isoWeekStart,
  isValidDate,
  localDateOf,
  maxDate,
  minDate,
  monthEnd,
  monthStart,
  nthWeekdayOfMonth,
  parseDate,
  quarterEnd,
  quarterStart,
  todayIn,
  utcOffsetMs,
  weekday,
  yearEnd,
  yearStart,
  zonedTimeToInstant,
} from "./dates";

const ZH = "Europe/Zurich";
const utc = (iso: string) => Date.parse(iso);

describe("isValidDate / parseDate / formatDate", () => {
  it.each([
    ["2026-01-01", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2100-02-29", false],
    ["2000-02-29", true],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-04-31", false],
    ["2026-4-1", false],
    ["26-04-01", false],
    ["2026-04-01T00:00", false],
    ["", false],
    ["0000-01-01", false],
    ["9999-12-31", true],
  ])("isValidDate(%s) = %s", (input, expected) => {
    expect(isValidDate(input)).toBe(expected);
  });

  it("parses and formats", () => {
    expect(parseDate("2026-03-09")).toEqual({ year: 2026, month: 3, day: 9 });
    expect(formatDate(2026, 3, 9)).toBe("2026-03-09");
    expect(formatDate(5, 1, 1)).toBe("0005-01-01");
  });

  it("throws on invalid input", () => {
    expect(() => parseDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatDate(2026, 2, 30)).toThrow(RangeError);
    expect(() => formatDate(10000, 1, 1)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe("leap years and month lengths", () => {
  it.each([
    [2024, true],
    [2026, false],
    [2028, true],
    [1900, false],
    [2000, true],
    [2100, false],
  ])("isLeapYear(%d) = %s", (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });

  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])("daysInMonth(%d, %d) = %d", (y, m, expected) => {
    expect(daysInMonth(y, m)).toBe(expected);
  });
});

describe("dayNumber / fromDayNumber", () => {
  it.each([
    ["1970-01-01", 0],
    ["1970-01-02", 1],
    ["1969-12-31", -1],
    ["2000-03-01", 11017],
    ["2026-10-06", 20732],
    ["2028-02-29", 21243],
  ])("%s <-> %d", (date, n) => {
    expect(dayNumber(date)).toBe(n);
    expect(fromDayNumber(n)).toBe(date);
  });

  it("round-trips every day over 120 years", () => {
    const start = dayNumber("1950-01-01");
    for (let n = start; n < start + 120 * 366; n += 1) {
      expect(dayNumber(fromDayNumber(n))).toBe(n);
    }
  });

  it("consecutive day numbers give consecutive valid dates", () => {
    const start = dayNumber("2020-01-01");
    let prev = fromDayNumber(start);
    for (let n = start + 1; n < start + 3000; n += 1) {
      const next = fromDayNumber(n);
      expect(isValidDate(next)).toBe(true);
      expect(next > prev).toBe(true);
      prev = next;
    }
  });

  it("rejects non-integers", () => {
    expect(() => fromDayNumber(1.5)).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-10-06", 0, "2026-10-06"],
    ["2026-01-01", 365, "2027-01-01"],
    ["2028-01-01", 366, "2029-01-01"],
    ["2026-10-06", -278, "2026-01-01"],
  ])("addDays(%s, %d) = %s", (date, n, expected) => {
    expect(addDays(date, n)).toBe(expected);
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-01-30", 1, "2026-02-28"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-05-31", -1, "2026-04-30"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-01-15", -1, "2025-12-15"],
    ["2026-01-31", 13, "2027-02-28"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2026-10-06", 0, "2026-10-06"],
    ["2026-10-06", 12, "2027-10-06"],
    ["2026-10-06", -24, "2024-10-06"],
    ["2026-01-31", 2, "2026-03-31"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2028-02-29", 48, "2032-02-29"],
  ])("addMonths(%s, %d) = %s", (date, n, expected) => {
    expect(addMonths(date, n)).toBe(expected);
  });
});

describe("addYears", () => {
  it.each([
    ["2028-02-29", 1, "2029-02-28"],
    ["2028-02-29", 4, "2032-02-29"],
    ["2028-02-29", -1, "2027-02-28"],
    ["2026-06-15", 1, "2027-06-15"],
    ["2026-06-15", -3, "2023-06-15"],
    ["2026-12-31", 1, "2027-12-31"],
  ])("addYears(%s, %d) = %s", (date, n, expected) => {
    expect(addYears(date, n)).toBe(expected);
  });
});

describe("weekday (ISO 1 = Monday)", () => {
  it.each([
    ["1970-01-01", 4],
    ["2026-10-05", 1],
    ["2026-10-06", 2],
    ["2026-10-11", 7],
    ["2028-02-29", 2],
    ["2026-03-29", 7],
    ["2026-10-25", 7],
    ["1969-12-31", 3],
    ["2000-01-01", 6],
  ])("weekday(%s) = %d", (date, expected) => {
    expect(weekday(date)).toBe(expected);
  });
});

describe("iso week boundaries", () => {
  it.each([
    ["2026-10-05", "2026-10-05", "2026-10-11"],
    ["2026-10-07", "2026-10-05", "2026-10-11"],
    ["2026-10-11", "2026-10-05", "2026-10-11"],
    ["2026-12-31", "2026-12-28", "2027-01-03"],
    ["2027-01-01", "2026-12-28", "2027-01-03"],
    ["2024-12-30", "2024-12-30", "2025-01-05"],
    ["2026-03-01", "2026-02-23", "2026-03-01"],
    ["2028-02-29", "2028-02-28", "2028-03-05"],
  ])("week of %s is %s .. %s", (date, start, end) => {
    expect(isoWeekStart(date)).toBe(start);
    expect(isoWeekEnd(date)).toBe(end);
  });

  it.each([
    ["2026-01-01", 2026, 1],
    ["2026-12-31", 2026, 53],
    ["2027-01-01", 2026, 53],
    ["2027-01-04", 2027, 1],
    ["2024-12-30", 2025, 1],
    ["2021-01-03", 2020, 53],
    ["2026-10-06", 2026, 41],
  ])("isoWeek(%s) = %d-W%d", (date, year, week) => {
    expect(isoWeek(date)).toEqual({ year, week });
  });
});

describe("month, quarter and year boundaries", () => {
  it.each([
    ["2026-02-14", "2026-02-01", "2026-02-28", "2026-01-01", "2026-03-31"],
    ["2028-02-14", "2028-02-01", "2028-02-29", "2028-01-01", "2028-03-31"],
    ["2026-04-30", "2026-04-01", "2026-04-30", "2026-04-01", "2026-06-30"],
    ["2026-06-30", "2026-06-01", "2026-06-30", "2026-04-01", "2026-06-30"],
    ["2026-07-01", "2026-07-01", "2026-07-31", "2026-07-01", "2026-09-30"],
    ["2026-12-31", "2026-12-01", "2026-12-31", "2026-10-01", "2026-12-31"],
  ])("%s", (date, ms, me, qs, qe) => {
    expect(monthStart(date)).toBe(ms);
    expect(monthEnd(date)).toBe(me);
    expect(quarterStart(date)).toBe(qs);
    expect(quarterEnd(date)).toBe(qe);
  });

  it("year start and end", () => {
    expect(yearStart("2026-10-06")).toBe("2026-01-01");
    expect(yearEnd("2026-10-06")).toBe("2026-12-31");
  });
});

describe("diffDays / compareDates / min / max", () => {
  it.each([
    ["2026-10-06", "2026-10-06", 0],
    ["2026-10-07", "2026-10-06", 1],
    ["2026-10-06", "2026-10-07", -1],
    ["2027-01-01", "2026-01-01", 365],
    ["2029-01-01", "2028-01-01", 366],
    ["2026-03-01", "2026-02-01", 28],
  ])("diffDays(%s, %s) = %d", (a, b, expected) => {
    expect(diffDays(a, b)).toBe(expected);
  });

  it("compares and picks", () => {
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareDates("2026-01-02", "2026-01-01")).toBe(1);
    expect(compareDates("2026-01-01", "2026-01-01")).toBe(0);
    expect(minDate("2026-01-01", "2026-01-02")).toBe("2026-01-01");
    expect(maxDate("2026-01-01", "2026-01-02")).toBe("2026-01-02");
  });
});

describe("nthWeekdayOfMonth", () => {
  it.each([
    [2026, 10, 2, 2, "2026-10-13"],
    [2026, 10, 2, 1, "2026-10-06"],
    [2026, 10, 2, 5, null],
    [2026, 10, 2, 4, "2026-10-27"],
    [2026, 10, 1, 5, null],
    [2026, 10, 1, 4, "2026-10-26"],
    [2026, 11, 1, 5, "2026-11-30"],
    [2026, 10, 5, -1, "2026-10-30"],
    [2026, 10, 7, -1, "2026-10-25"],
    [2026, 10, 7, -2, "2026-10-18"],
    [2026, 2, 6, -1, "2026-02-28"],
    [2028, 2, 2, -1, "2028-02-29"],
    [2026, 2, 3, 5, null],
    [2026, 2, 3, -5, null],
    [2026, 10, 4, 1, "2026-10-01"],
    [2026, 3, 7, 5, "2026-03-29"],
  ])(
    "nthWeekdayOfMonth(%d, %d, wd %d, nth %d) = %s",
    (y, m, wd, nth, expected) => {
      expect(nthWeekdayOfMonth(y, m, wd, nth)).toBe(expected);
    },
  );

  it("rejects nth 0", () => {
    expect(() => nthWeekdayOfMonth(2026, 1, 1, 0)).toThrow(RangeError);
  });
});

describe("localDateOf / todayIn", () => {
  it.each([
    ["2026-10-06T00:00:00Z", ZH, "2026-10-06"],
    ["2026-10-05T21:59:59Z", ZH, "2026-10-05"],
    ["2026-10-05T22:00:00Z", ZH, "2026-10-06"],
    ["2026-01-15T22:59:59Z", ZH, "2026-01-15"],
    ["2026-01-15T23:00:00Z", ZH, "2026-01-16"],
    ["2026-03-28T22:59:59Z", ZH, "2026-03-28"],
    ["2026-03-28T23:00:00Z", ZH, "2026-03-29"],
    ["2026-03-29T21:59:59Z", ZH, "2026-03-29"],
    ["2026-03-29T22:00:00Z", ZH, "2026-03-30"],
    ["2026-10-24T21:59:59Z", ZH, "2026-10-24"],
    ["2026-10-24T22:00:00Z", ZH, "2026-10-25"],
    ["2026-10-25T22:59:59Z", ZH, "2026-10-25"],
    ["2026-10-25T23:00:00Z", ZH, "2026-10-26"],
    ["2026-12-31T23:30:00Z", ZH, "2027-01-01"],
    ["2028-02-28T23:30:00Z", ZH, "2028-02-29"],
    ["2026-10-06T00:00:00Z", "America/Los_Angeles", "2026-10-05"],
    ["2026-10-06T00:00:00Z", "UTC", "2026-10-06"],
    ["2026-10-06T23:30:00Z", "Pacific/Auckland", "2026-10-07"],
  ])("%s in %s = %s", (iso, tz, expected) => {
    expect(localDateOf(tz, utc(iso))).toBe(expected);
    expect(todayIn(tz, utc(iso))).toBe(expected);
  });

  it("handles instants before the epoch", () => {
    expect(localDateOf(ZH, utc("1969-12-31T23:30:00Z"))).toBe("1970-01-01");
    expect(localDateOf("UTC", utc("1969-12-31T23:59:59Z"))).toBe("1969-12-31");
  });

  it("throws for unknown zones and invalid instants", () => {
    expect(() => localDateOf("Not/AZone", 0)).toThrow(RangeError);
    expect(() => localDateOf(ZH, Number.NaN)).toThrow(RangeError);
  });
});

describe("utcOffsetMs", () => {
  it.each([
    ["2026-01-15T12:00:00Z", ZH, 3600_000],
    ["2026-07-15T12:00:00Z", ZH, 7200_000],
    ["2026-03-29T00:59:59Z", ZH, 3600_000],
    ["2026-03-29T01:00:00Z", ZH, 7200_000],
    ["2026-10-25T00:59:59Z", ZH, 7200_000],
    ["2026-10-25T01:00:00Z", ZH, 3600_000],
    ["2026-07-15T12:00:00Z", "UTC", 0],
  ])("offset at %s in %s", (iso, tz, expected) => {
    expect(utcOffsetMs(tz, utc(iso))).toBe(expected);
  });
});

describe("zonedTimeToInstant", () => {
  it.each([
    ["winter 18:00", "2026-01-15", "18:00", ZH, "2026-01-15T17:00:00Z"],
    ["summer 18:00", "2026-07-15", "18:00", ZH, "2026-07-15T16:00:00Z"],
    [
      "day before spring forward",
      "2026-03-28",
      "18:00",
      ZH,
      "2026-03-28T17:00:00Z",
    ],
    [
      "spring forward day evening",
      "2026-03-29",
      "18:00",
      ZH,
      "2026-03-29T16:00:00Z",
    ],
    [
      "spring forward day 01:59",
      "2026-03-29",
      "01:59",
      ZH,
      "2026-03-29T00:59:00Z",
    ],
    [
      "spring forward day 03:00",
      "2026-03-29",
      "03:00",
      ZH,
      "2026-03-29T01:00:00Z",
    ],
    [
      "spring forward gap 02:00",
      "2026-03-29",
      "02:00",
      ZH,
      "2026-03-29T01:00:00Z",
    ],
    [
      "spring forward gap 02:30",
      "2026-03-29",
      "02:30",
      ZH,
      "2026-03-29T01:30:00Z",
    ],
    ["fall back day before", "2026-10-24", "18:00", ZH, "2026-10-24T16:00:00Z"],
    [
      "fall back day evening",
      "2026-10-25",
      "18:00",
      ZH,
      "2026-10-25T17:00:00Z",
    ],
    [
      "fall back overlap 02:30 first",
      "2026-10-25",
      "02:30",
      ZH,
      "2026-10-25T00:30:00Z",
    ],
    [
      "fall back 01:59 unambiguous",
      "2026-10-25",
      "01:59",
      ZH,
      "2026-10-24T23:59:00Z",
    ],
    [
      "fall back 03:00 unambiguous",
      "2026-10-25",
      "03:00",
      ZH,
      "2026-10-25T02:00:00Z",
    ],
    ["midnight", "2026-10-06", "00:00", ZH, "2026-10-05T22:00:00Z"],
    ["end of day", "2026-10-06", "23:59", ZH, "2026-10-06T21:59:00Z"],
    ["leap day", "2028-02-29", "07:30", ZH, "2028-02-29T06:30:00Z"],
    ["utc", "2026-10-06", "18:00", "UTC", "2026-10-06T18:00:00Z"],
    [
      "new york summer",
      "2026-07-01",
      "09:00",
      "America/New_York",
      "2026-07-01T13:00:00Z",
    ],
    [
      "us spring forward gap",
      "2026-03-08",
      "02:30",
      "America/New_York",
      "2026-03-08T07:30:00Z",
    ],
    [
      "ahead of utc",
      "2026-10-06",
      "09:00",
      "Asia/Tokyo",
      "2026-10-06T00:00:00Z",
    ],
  ])("%s", (_name, date, time, tz, expected) => {
    expect(zonedTimeToInstant(date, time, tz)).toBe(utc(expected));
  });

  it("round-trips through localDateOf for every day of 2026 at 18:00", () => {
    let date = "2026-01-01";
    while (date <= "2026-12-31") {
      const instant = zonedTimeToInstant(date, "18:00", ZH);
      expect(localDateOf(ZH, instant)).toBe(date);
      expect(new Date(instant).getUTCMinutes()).toBe(0);
      date = addDays(date, 1);
    }
  });

  it("rejects malformed times", () => {
    for (const bad of ["24:00", "9:00", "09:60", "0900", ""]) {
      expect(() => zonedTimeToInstant("2026-10-06", bad, ZH)).toThrow(
        RangeError,
      );
    }
  });
});

describe("date properties", () => {
  it("dayNumber and weekday agree with the platform's UTC math", () => {
    for (
      let n = dayNumber("1900-01-01");
      n <= dayNumber("2100-12-31");
      n += 7
    ) {
      const date = fromDayNumber(n);
      const ms = Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      );
      expect(ms / 86_400_000).toBe(n);
      const utcDay = new Date(ms).getUTCDay();
      expect(weekday(date)).toBe(utcDay === 0 ? 7 : utcDay);
      expect(weekday(addDays(date, 1))).toBe((weekday(date) % 7) + 1);
    }
  });

  it("addMonths keeps the day or clamps to the month end", () => {
    for (
      let n = dayNumber("2024-01-01");
      n <= dayNumber("2029-12-31");
      n += 3
    ) {
      const date = fromDayNumber(n);
      const { year, month, day } = parseDate(date);
      for (const months of [-25, -13, -12, -1, 0, 1, 2, 11, 12, 13, 25]) {
        const result = parseDate(addMonths(date, months));
        const total = year * 12 + (month - 1) + months;
        expect(result.year).toBe(Math.floor(total / 12));
        expect(result.month).toBe((((total % 12) + 12) % 12) + 1);
        expect(result.day).toBe(
          Math.min(day, daysInMonth(result.year, result.month)),
        );
      }
    }
  });

  it("monthEnd + 1 is the next month start", () => {
    for (
      let n = dayNumber("2024-01-01");
      n <= dayNumber("2030-12-31");
      n += 5
    ) {
      const date = fromDayNumber(n);
      expect(addDays(monthEnd(date), 1)).toBe(addMonths(monthStart(date), 1));
      expect(addDays(quarterEnd(date), 1)).toBe(
        addMonths(quarterStart(date), 3),
      );
      expect(addDays(yearEnd(date), 1)).toBe(addYears(yearStart(date), 1));
      expect(addDays(isoWeekEnd(date), 1)).toBe(addDays(isoWeekStart(date), 7));
      expect(weekday(isoWeekStart(date))).toBe(1);
      expect(weekday(isoWeekEnd(date))).toBe(7);
    }
  });
});

describe("zonedTimeToInstant against Intl", () => {
  const zones = [
    "Europe/Zurich",
    "America/New_York",
    "Australia/Sydney",
    "Australia/Lord_Howe",
    "Asia/Kathmandu",
    "Pacific/Auckland",
    "UTC",
  ];
  const wall = (tz: string, instant: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(instant);
    return parts;
  };

  it.each(zones)("%s: every quarter hour of a normal day round-trips", (tz) => {
    for (const date of ["2026-01-15", "2026-07-15", "2028-02-29"]) {
      for (let minutes = 0; minutes < 1440; minutes += 15) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        const instant = zonedTimeToInstant(date, `${hh}:${mm}`, tz);
        expect(wall(tz, instant)).toBe(`${hh}:${mm}`);
        expect(localDateOf(tz, instant)).toBe(date);
      }
    }
  });

  it.each([
    ["Europe/Zurich", ["2026-03-29", "2026-10-25"]],
    ["America/New_York", ["2026-03-08", "2026-11-01"]],
    ["Australia/Sydney", ["2026-04-05", "2026-10-04"]],
    ["Australia/Lord_Howe", ["2026-04-05", "2026-10-04"]],
    ["Pacific/Auckland", ["2026-04-05", "2026-09-27"]],
  ])("%s: DST days resolve every wall time deterministically", (tz, dates) => {
    for (const date of dates) {
      let previous = Number.NEGATIVE_INFINITY;
      for (let minutes = 0; minutes < 1440; minutes += 15) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        const instant = zonedTimeToInstant(date, `${hh}:${mm}`, tz);
        const shown = wall(tz, instant);
        const shiftedMinutes =
          Number(shown.slice(0, 2)) * 60 + Number(shown.slice(3, 5)) - minutes;
        expect([0, 30, 60]).toContain(
          shiftedMinutes < 0 ? shiftedMinutes + 1440 : shiftedMinutes,
        );
        expect(instant).toBeGreaterThanOrEqual(previous - 3_600_000);
        previous = instant;
      }
    }
  });

  it("resolves the DST gap and overlap in Zurich consistently", () => {
    const spring = ["02:00", "02:15", "02:45"].map((t) =>
      wall(ZH, zonedTimeToInstant("2026-03-29", t, ZH)),
    );
    expect(spring).toEqual(["03:00", "03:15", "03:45"]);
    const autumn = ["02:00", "02:15", "02:45"].map((t) =>
      zonedTimeToInstant("2026-10-25", t, ZH),
    );
    for (const instant of autumn)
      expect(utcOffsetMs(ZH, instant)).toBe(7200_000);
  });
});
