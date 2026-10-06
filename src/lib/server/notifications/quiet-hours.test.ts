import { describe, expect, it } from "vitest";
import { at } from "$lib/testing/domain";
import { inQuietHours, localMinutes } from "./quiet-hours";

const TZ = "Europe/Zurich";

describe("quiet hours", () => {
  it("reads the local time of the zone, not the server's", () => {
    expect(localMinutes(at("2026-06-15", "07:30"), TZ)).toBe(7 * 60 + 30);
    expect(localMinutes(at("2026-01-15", "23:59"), TZ)).toBe(23 * 60 + 59);
    expect(localMinutes(at("2026-06-15", "00:00"), TZ)).toBe(0);
  });

  it.each([
    ["same-day window, inside", "13:00", "12:00", "14:00", true],
    ["same-day window, start is inside", "12:00", "12:00", "14:00", true],
    ["same-day window, end is outside", "14:00", "12:00", "14:00", false],
    ["same-day window, before", "11:59", "12:00", "14:00", false],
    ["wrapping window, late evening", "23:30", "22:00", "07:00", true],
    ["wrapping window, early morning", "06:59", "22:00", "07:00", true],
    ["wrapping window, end is outside", "07:00", "22:00", "07:00", false],
    ["wrapping window, daytime", "15:00", "22:00", "07:00", false],
    ["wrapping window, start is inside", "22:00", "22:00", "07:00", true],
    ["equal bounds mean no window", "03:00", "03:00", "03:00", false],
  ])("%s", (_name, time, start, end, quiet) => {
    expect(inQuietHours(at("2026-06-15", time), TZ, start, end)).toBe(quiet);
  });

  it("is never quiet without both bounds", () => {
    expect(inQuietHours(at("2026-06-15", "03:00"), TZ, null, "07:00")).toBe(
      false,
    );
    expect(inQuietHours(at("2026-06-15", "03:00"), TZ, "22:00", null)).toBe(
      false,
    );
    expect(inQuietHours(at("2026-06-15", "03:00"), TZ, null, null)).toBe(false);
  });

  it("follows daylight saving time", () => {
    // 23:30 UTC on 30 March 2026 is 01:30 CEST on the 31st: inside 22:00-07:00
    expect(
      inQuietHours(Date.UTC(2026, 2, 30, 23, 30), TZ, "22:00", "07:00"),
    ).toBe(true);
    // 12:00 UTC in June is 14:00 CEST
    expect(
      inQuietHours(Date.UTC(2026, 5, 15, 12, 0), TZ, "13:00", "15:00"),
    ).toBe(true);
  });
});
