import { describe, expect, it } from "vitest";
import { describeTrigger } from "./describe";
import type { Trigger } from "./engine/types";

type Case = { name: string; trigger: Trigger; de: string; en: string };

const cases: Case[] = [
  {
    name: "interval from completion",
    trigger: {
      v: 1,
      type: "interval",
      every: 3,
      unit: "month",
      anchor: "completion",
      startDate: "2026-10-01",
    },
    de: "Alle 3 Monate ab letzter Erledigung",
    en: "Every 3 months from the last completion",
  },
  {
    name: "interval every single unit",
    trigger: {
      v: 1,
      type: "interval",
      every: 1,
      unit: "week",
      anchor: "completion",
      startDate: "2026-10-01",
    },
    de: "Jede Woche ab letzter Erledigung",
    en: "Every week from the last completion",
  },
  {
    name: "interval on a fixed schedule",
    trigger: {
      v: 1,
      type: "interval",
      every: 1,
      unit: "year",
      anchor: "schedule",
      startDate: "2026-03-15",
    },
    de: "Jedes Jahr (fester Rhythmus ab 15.03.2026)",
    en: "Every year (fixed schedule from 15 Mar 2026)",
  },
  {
    name: "interval with seasons",
    trigger: {
      v: 1,
      type: "interval",
      every: 2,
      unit: "week",
      anchor: "completion",
      startDate: "2026-04-01",
      seasons: [{ fromMonth: 11, toMonth: 3, every: 1, unit: "month" }],
    },
    de: "Alle 2 Wochen ab letzter Erledigung; November bis März: jeden Monat",
    en: "Every 2 weeks from the last completion; November to March: every month",
  },
  {
    name: "weekly on one weekday",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      byWeekday: [6],
      startDate: "2026-10-03",
    },
    de: "Jeden Samstag",
    en: "Every Saturday",
  },
  {
    name: "weekly on several weekdays, every other week",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 2,
      byWeekday: [5, 1, 3],
      startDate: "2026-10-05",
    },
    de: "Alle 2 Wochen am Montag, Mittwoch und Freitag",
    en: "Every 2 weeks on Monday, Wednesday and Friday",
  },
  {
    name: "weekly defaults to the start date's weekday",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "weekly",
      interval: 1,
      startDate: "2026-10-07",
    },
    de: "Jeden Mittwoch",
    en: "Every Wednesday",
  },
  {
    name: "monthly on a day",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byMonthDay: 15,
      startDate: "2026-10-01",
    },
    de: "Jeden Monat am 15.",
    en: "Every month on the 15th",
  },
  {
    name: "monthly on the last day, every two months",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 2,
      byMonthDay: -1,
      startDate: "2026-10-01",
    },
    de: "Alle 2 Monate am letzten Tag",
    en: "Every 2 months on the last day",
  },
  {
    name: "monthly on the second-to-last day",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byMonthDay: -2,
      startDate: "2026-10-01",
    },
    de: "Jeden Monat am vorletzten Tag",
    en: "Every month on the second-to-last day",
  },
  {
    name: "monthly on the nth weekday",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byWeekday: [1],
      nth: 1,
      startDate: "2026-10-05",
    },
    de: "Jeden Monat am ersten Montag",
    en: "Every month on the first Monday",
  },
  {
    name: "monthly on the last weekday, limited to months",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "monthly",
      interval: 1,
      byWeekday: [5],
      nth: -1,
      byMonth: [3, 9],
      startDate: "2026-09-25",
    },
    de: "Jeden Monat am letzten Freitag, nur im März und September",
    en: "Every month on the last Friday, only in March and September",
  },
  {
    name: "yearly in months",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "yearly",
      interval: 1,
      byMonth: [3, 9],
      byMonthDay: 1,
      startDate: "2026-03-01",
    },
    de: "Jedes Jahr am 1. im März und September",
    en: "Every year on the 1st in March and September",
  },
  {
    name: "yearly defaults to the start date",
    trigger: {
      v: 1,
      type: "calendar",
      freq: "yearly",
      interval: 2,
      startDate: "2026-05-22",
    },
    de: "Alle 2 Jahre am 22. im Mai",
    en: "Every 2 years on the 22nd in May",
  },
  {
    name: "minimum per period",
    trigger: { v: 1, type: "min_per_period", period: "month", count: 1 },
    de: "Mindestens 1× pro Monat",
    en: "At least 1× per month",
  },
  {
    name: "minimum per quarter",
    trigger: { v: 1, type: "min_per_period", period: "quarter", count: 3 },
    de: "Mindestens 3× pro Quartal",
    en: "At least 3× per quarter",
  },
  {
    name: "counter with a unit",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "sensor.washer_cycles",
      threshold: 5,
      unit: "Waschgänge",
    },
    de: "Alle 5 Waschgänge (Home-Assistant-Zähler)",
    en: "Every 5 Waschgänge (Home Assistant counter)",
  },
  {
    name: "counter without a unit",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "sensor.hours",
      threshold: 250.5,
    },
    de: "Bei einem Zählerzuwachs von 250.5 (Home-Assistant-Zähler)",
    en: "At a meter increase of 250.5 (Home Assistant counter)",
  },
  {
    name: "odometer counter",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "odometer:abc",
      threshold: 15000,
      unit: "km",
    },
    de: "Alle 15'000 km (Tachostand)",
    en: "Every 15,000 km (odometer)",
  },
  {
    name: "odometer counter with a time limit in months",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "odometer:abc",
      threshold: 15000,
      unit: "km",
      orEvery: { every: 12, unit: "month" },
    },
    de: "Alle 15'000 km (Tachostand), oder alle 12 Monate, je nachdem, was zuerst eintritt",
    en: "Every 15,000 km (odometer), or every 12 months, whichever comes first",
  },
  {
    name: "counter with a time limit of one year",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "sensor.hours",
      threshold: 250,
      unit: "h",
      orEvery: { every: 1, unit: "year" },
    },
    de: "Alle 250 h (Home-Assistant-Zähler), oder jedes Jahr, je nachdem, was zuerst eintritt",
    en: "Every 250 h (Home Assistant counter), or every year, whichever comes first",
  },
  {
    name: "counter without a unit and with a time limit",
    trigger: {
      v: 1,
      type: "counter_delta",
      entityId: "odometer:abc",
      threshold: 500,
      orEvery: { every: 6, unit: "week" },
    },
    de: "Bei einem Zuwachs des Tachostands von 500, oder alle 6 Wochen, je nachdem, was zuerst eintritt",
    en: "At an odometer increase of 500, or every 6 weeks, whichever comes first",
  },
  {
    name: "state condition",
    trigger: {
      v: 1,
      type: "state_condition",
      entityId: "sensor.filter_pressure",
      op: "gt",
      value: 80,
    },
    de: "Wenn sensor.filter_pressure grösser als 80 ist",
    en: "When sensor.filter_pressure is greater than 80",
  },
  {
    name: "state condition held for a while",
    trigger: {
      v: 1,
      type: "state_condition",
      entityId: "binary_sensor.window",
      op: "eq",
      value: "on",
      forMinutes: 30,
    },
    de: "Wenn binary_sensor.window gleich on ist, seit mindestens 30 Min.",
    en: "When binary_sensor.window is equal to on, for at least 30 min",
  },
  {
    name: "calendar event on the day",
    trigger: {
      v: 1,
      type: "ha_calendar",
      entityId: "calendar.waste",
      offsetDays: 0,
    },
    de: "Am Tag eines Kalendertermins (Home Assistant)",
    en: "On the day of a calendar event (Home Assistant)",
  },
  {
    name: "calendar event the day before",
    trigger: {
      v: 1,
      type: "ha_calendar",
      entityId: "calendar.waste",
      offsetDays: -1,
      summaryMatch: "Karton",
    },
    de: "1 Tag vor einem Kalendertermin (Home Assistant), Titel enthält «Karton»",
    en: '1 day before a calendar event (Home Assistant), title contains "Karton"',
  },
  {
    name: "calendar event days after",
    trigger: {
      v: 1,
      type: "ha_calendar",
      entityId: "calendar.waste",
      offsetDays: 3,
    },
    de: "3 Tage nach einem Kalendertermin (Home Assistant)",
    en: "3 days after a calendar event (Home Assistant)",
  },
  {
    name: "one-off",
    trigger: { v: 1, type: "one_off", date: "2027-03-15" },
    de: "Einmalig am 15.03.2027",
    en: "Once on 15 Mar 2027",
  },
  {
    name: "bill",
    trigger: {
      v: 1,
      type: "kept_bill",
      billId: "b1",
      dueDate: "2026-12-31",
      status: "open",
    },
    de: "Rechnung fällig am 31.12.2026",
    en: "Bill due on 31 Dec 2026",
  },
  {
    name: "warranty",
    trigger: { v: 1, type: "warranty", until: "2027-11-20" },
    de: "Garantie bis 20.11.2027",
    en: "Warranty until 20 Nov 2027",
  },
  {
    name: "extended warranty",
    trigger: {
      v: 1,
      type: "warranty",
      until: "2027-11-20",
      extendedUntil: "2029-11-20",
    },
    de: "Garantie bis 20.11.2027, verlängert bis 20.11.2029",
    en: "Warranty until 20 Nov 2027, extended until 20 Nov 2029",
  },
];

describe("describeTrigger", () => {
  for (const c of cases) {
    it(`describes ${c.name} in German`, () => {
      expect(describeTrigger(c.trigger, "de")).toBe(c.de);
    });
    it(`describes ${c.name} in English`, () => {
      expect(describeTrigger(c.trigger, "en")).toBe(c.en);
    });
  }
});
