import { describe, expect, it } from "vitest";
import { zonedTimeToInstant } from "../dates";
import {
  defaultEnd,
  endInstant,
  lastDay,
  MAX_APPOINTMENT_DAYS,
  startInstant,
  whenProblem,
  type AppointmentWhen,
} from "./when";

const ZH = "Europe/Zurich";
const at = (date: string, time: string) => zonedTimeToInstant(date, time, ZH);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("whenProblem", () => {
  const start = at("2026-06-15", "09:00");
  it.each<[string, AppointmentWhen, string | null]>([
    [
      "a timed appointment of an hour",
      { allDay: false, startsAt: start, endsAt: start + HOUR },
      null,
    ],
    [
      "a timed appointment of exactly 14 days",
      { allDay: false, startsAt: start, endsAt: start + 14 * DAY },
      null,
    ],
    [
      "a timed appointment of 14 days and an hour, the most a clock change adds",
      { allDay: false, startsAt: start, endsAt: start + 14 * DAY + HOUR },
      null,
    ],
    [
      "a timed appointment of 14 days, an hour and a millisecond",
      { allDay: false, startsAt: start, endsAt: start + 14 * DAY + HOUR + 1 },
      "endsAt",
    ],
    [
      "14 calendar days across the night the clocks go back (an hour longer than 14 days)",
      {
        allDay: false,
        startsAt: at("2026-10-18", "09:00"),
        endsAt: at("2026-11-01", "09:00"),
      },
      null,
    ],
    [
      "14 calendar days across the night the clocks go forward (an hour shorter than 14 days)",
      {
        allDay: false,
        startsAt: at("2026-03-22", "09:00"),
        endsAt: at("2026-04-05", "09:00"),
      },
      null,
    ],
    [
      "more than 14 calendar days across the night the clocks go back",
      {
        allDay: false,
        startsAt: at("2026-10-18", "09:00"),
        endsAt: at("2026-11-01", "10:01"),
      },
      "endsAt",
    ],
    [
      "more than 14 calendar days across the night the clocks go forward",
      {
        allDay: false,
        startsAt: at("2026-03-22", "09:00"),
        endsAt: at("2026-04-06", "10:01"),
      },
      "endsAt",
    ],
    [
      "an end equal to the start",
      { allDay: false, startsAt: start, endsAt: start },
      "endsAt",
    ],
    [
      "an end before the start",
      { allDay: false, startsAt: start, endsAt: start - 1 },
      "endsAt",
    ],
    [
      "a single all-day appointment",
      { allDay: true, startDate: "2026-06-15", endDate: "2026-06-15" },
      null,
    ],
    [
      "an all-day appointment of 14 days, both days counted",
      { allDay: true, startDate: "2026-06-15", endDate: "2026-06-28" },
      null,
    ],
    [
      "an all-day appointment of 15 days",
      { allDay: true, startDate: "2026-06-15", endDate: "2026-06-29" },
      "endDate",
    ],
    [
      "an all-day end before the start",
      { allDay: true, startDate: "2026-06-15", endDate: "2026-06-14" },
      "endDate",
    ],
    [
      "an all-day span over a month and year end",
      { allDay: true, startDate: "2026-12-30", endDate: "2027-01-02" },
      null,
    ],
  ])("%s", (_name, when, field) => {
    expect(whenProblem(when)?.field ?? null).toBe(field);
  });

  it("says the limit in the message", () => {
    const problem = whenProblem({
      allDay: true,
      startDate: "2026-06-01",
      endDate: "2026-07-01",
    });
    expect(problem?.message).toContain(String(MAX_APPOINTMENT_DAYS));
  });
});

describe("defaultEnd", () => {
  it("is an hour after the start", () => {
    expect(defaultEnd(1_000)).toBe(1_000 + HOUR);
  });
});

describe("startInstant / endInstant", () => {
  it("are the instants of a timed appointment", () => {
    const when: AppointmentWhen = {
      allDay: false,
      startsAt: at("2026-06-15", "09:00"),
      endsAt: at("2026-06-15", "10:30"),
    };
    expect(startInstant(when, ZH)).toBe(when.startsAt);
    expect(endInstant(when, ZH)).toBe(when.endsAt);
  });

  it("are midnight of the first day and of the day after the last for an all-day one", () => {
    const when: AppointmentWhen = {
      allDay: true,
      startDate: "2026-06-15",
      endDate: "2026-06-16",
    };
    expect(startInstant(when, ZH)).toBe(at("2026-06-15", "00:00"));
    expect(endInstant(when, ZH)).toBe(at("2026-06-17", "00:00"));
  });

  it("count the 23 hours of the day Europe/Zurich springs forward", () => {
    const when: AppointmentWhen = {
      allDay: true,
      startDate: "2026-03-29",
      endDate: "2026-03-29",
    };
    expect(endInstant(when, ZH) - startInstant(when, ZH)).toBe(23 * HOUR);
  });

  it("count the 25 hours of the day it falls back", () => {
    const when: AppointmentWhen = {
      allDay: true,
      startDate: "2026-10-25",
      endDate: "2026-10-25",
    };
    expect(endInstant(when, ZH) - startInstant(when, ZH)).toBe(25 * HOUR);
  });

  it("depend on the zone", () => {
    const when: AppointmentWhen = {
      allDay: true,
      startDate: "2026-06-15",
      endDate: "2026-06-15",
    };
    expect(startInstant(when, "UTC")).toBe(Date.UTC(2026, 5, 15));
    expect(startInstant(when, "America/Los_Angeles")).toBe(
      Date.UTC(2026, 5, 15, 7),
    );
  });
});

describe("lastDay", () => {
  it.each<[string, AppointmentWhen, string]>([
    [
      "the day a timed appointment ends on",
      {
        allDay: false,
        startsAt: at("2026-06-15", "22:00"),
        endsAt: at("2026-06-16", "01:00"),
      },
      "2026-06-16",
    ],
    [
      "the day before when it ends at midnight",
      {
        allDay: false,
        startsAt: at("2026-06-15", "22:00"),
        endsAt: at("2026-06-16", "00:00"),
      },
      "2026-06-15",
    ],
    [
      "the same day for one within a day",
      {
        allDay: false,
        startsAt: at("2026-06-15", "09:00"),
        endsAt: at("2026-06-15", "10:00"),
      },
      "2026-06-15",
    ],
    [
      "the end date of an all-day one",
      { allDay: true, startDate: "2026-06-15", endDate: "2026-06-17" },
      "2026-06-17",
    ],
  ])("is %s", (_name, when, expected) => {
    expect(lastDay(when, ZH)).toBe(expected);
  });

  it("is read in the zone given", () => {
    const when: AppointmentWhen = {
      allDay: false,
      startsAt: Date.UTC(2026, 5, 15, 21),
      endsAt: Date.UTC(2026, 5, 15, 23),
    };
    expect(lastDay(when, "UTC")).toBe("2026-06-15");
    expect(lastDay(when, ZH)).toBe("2026-06-16");
  });
});
