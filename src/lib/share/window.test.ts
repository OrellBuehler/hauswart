import { describe, expect, it } from "vitest";
import { defaultUntil, endInstant, latestUntil, startInstant } from "./window";

const zone = "Europe/Zurich";

describe("guest link window", () => {
  it("defaults to two weeks and allows 90 days", () => {
    expect(defaultUntil("2026-10-06")).toBe("2026-10-20");
    expect(latestUntil("2026-10-06")).toBe("2027-01-04");
  });

  it("starts at midnight and ends at 23:59 in the household zone", () => {
    expect(new Date(startInstant("2026-10-12", zone)).toISOString()).toBe(
      "2026-10-11T22:00:00.000Z",
    );
    const now = Date.parse("2026-10-06T10:00:00Z");
    expect(new Date(endInstant("2026-10-20", zone, now)).toISOString()).toBe(
      "2026-10-20T21:59:00.000Z",
    );
  });

  it("clamps the last allowed day to the 90-day limit", () => {
    const now = Date.parse("2026-10-06T10:00:00Z");
    const end = endInstant(latestUntil("2026-10-06"), zone, now);
    expect(end).toBeLessThan(now + 90 * 86_400_000);
    expect(end).toBeGreaterThan(now + 89 * 86_400_000);
  });
});
