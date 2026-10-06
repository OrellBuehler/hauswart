import { afterEach, describe, expect, it } from "vitest";
import { dateInZone, householdTimeZone, todayInHouseholdZone } from "./config";

const original = process.env.HAUSWART_TZ;
afterEach(() => {
  if (original === undefined) delete process.env.HAUSWART_TZ;
  else process.env.HAUSWART_TZ = original;
});

describe("dateInZone", () => {
  it.each([
    ["Europe/Zurich", "2026-03-14T23:30:00Z", "2026-03-15"],
    ["Europe/Zurich", "2026-03-14T22:30:00Z", "2026-03-14"],
    ["UTC", "2026-03-14T23:30:00Z", "2026-03-14"],
    ["Pacific/Auckland", "2026-12-31T12:00:00Z", "2027-01-01"],
    ["America/Los_Angeles", "2026-01-01T07:59:00Z", "2025-12-31"],
    ["Europe/Zurich", "2028-02-29T00:30:00Z", "2028-02-29"],
    ["Europe/Zurich", "2026-10-25T22:30:00Z", "2026-10-25"],
  ])("%s at %s is %s", (zone, instant, expected) => {
    expect(dateInZone(Date.parse(instant), zone)).toBe(expected);
  });
});

describe("household time zone", () => {
  it("defaults to Europe/Zurich", () => {
    delete process.env.HAUSWART_TZ;
    expect(householdTimeZone()).toBe("Europe/Zurich");
  });

  it("reads HAUSWART_TZ", () => {
    process.env.HAUSWART_TZ = "Asia/Tokyo";
    expect(householdTimeZone()).toBe("Asia/Tokyo");
    expect(todayInHouseholdZone(Date.parse("2026-05-01T16:00:00Z"))).toBe(
      "2026-05-02",
    );
  });

  it("fails clearly on an unknown zone", () => {
    process.env.HAUSWART_TZ = "Mars/Olympus";
    expect(() => householdTimeZone()).toThrow(/HAUSWART_TZ/);
  });
});
