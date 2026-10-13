import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatOrdinalDay,
  formatRelativeDays,
  monthInDate,
  weekdayName,
} from "./format";

describe("format", () => {
  it("shows a calendar date without shifting the day, whatever the time zone", () => {
    expect(formatDate("2026-10-06", "de")).toBe("06.10.2026");
    expect(formatDate("2026-01-01", "en")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31", "de")).toBe("31.12.2026");
  });

  it("adds the weekday and drops the year within the current year", () => {
    expect(
      formatDateShort("2026-10-10", { today: "2026-10-06", locale: "de" }),
    ).toMatch(/^Sa\.?,? 10\. Okt\.?$/);
    expect(
      formatDateShort("2027-10-04", { today: "2026-10-06", locale: "en" }),
    ).toBe("Mon, 4 Oct 2027");
  });

  it("can leave the weekday out", () => {
    expect(
      formatDateShort("2026-10-10", {
        today: "2026-10-06",
        locale: "en",
        weekday: false,
      }),
    ).toBe("10 Oct");
    expect(
      formatDateShort("2027-10-04", {
        today: "2026-10-06",
        locale: "de",
        weekday: false,
      }),
    ).toMatch(/^4\. Okt\.? 2027$/);
  });

  it("words day differences", () => {
    expect(formatRelativeDays(0, "en")).toBe("today");
    expect(formatRelativeDays(1, "en")).toBe("tomorrow");
    expect(formatRelativeDays(-3, "en")).toBe("3 days ago");
    expect(formatRelativeDays(21, "en")).toBe("in 3 weeks");
    expect(formatRelativeDays(0, "de")).toBe("heute");
  });

  it("writes a month the way it stands next to a day", () => {
    expect(monthInDate(1, "de")).toBe("Jan.");
    expect(monthInDate(3, "de")).toBe("März");
    expect(monthInDate(12, "de")).toBe("Dez.");
    expect(monthInDate(1, "en")).toBe("Jan");
    expect(monthInDate(10, "en")).toBe("Oct");
  });

  it("names weekdays and ordinal days", () => {
    expect(weekdayName(1, "long", "de")).toBe("Montag");
    expect(weekdayName(7, "long", "en")).toBe("Sunday");
    expect(formatOrdinalDay(22, "en")).toBe("22nd");
    expect(formatOrdinalDay(3, "de")).toBe("3.");
  });
});
