import { describe, expect, it } from "vitest";
import { WARRANTY_EXPIRING_DAYS, warrantyStatus } from "./warranty";

const TODAY = "2026-10-06";

function check(warrantyUntil: string | null, extended: string | null = null) {
  return warrantyStatus(
    { warrantyUntil, warrantyExtendedUntil: extended },
    TODAY,
  );
}

describe("warrantyStatus", () => {
  it("is unknown without any date", () => {
    expect(check(null)).toEqual({
      status: "unknown",
      until: null,
      daysLeft: null,
    });
  });

  it("is valid beyond the expiring window", () => {
    expect(check("2027-11-20")).toMatchObject({
      status: "valid",
      until: "2027-11-20",
    });
  });

  it("expires within 90 days, boundary included", () => {
    expect(WARRANTY_EXPIRING_DAYS).toBe(90);
    expect(check("2027-01-04")).toMatchObject({
      status: "expiring",
      daysLeft: 90,
    });
    expect(check("2027-01-05")).toMatchObject({
      status: "valid",
      daysLeft: 91,
    });
  });

  it("is still expiring on its last day and expired the day after", () => {
    expect(check(TODAY)).toMatchObject({ status: "expiring", daysLeft: 0 });
    expect(check("2026-10-05")).toMatchObject({
      status: "expired",
      daysLeft: -1,
    });
  });

  it("lets the later of the two dates win", () => {
    expect(check("2026-09-01", "2028-09-01")).toMatchObject({
      status: "valid",
      until: "2028-09-01",
    });
    expect(check("2028-09-01", "2026-09-01")).toMatchObject({
      status: "valid",
      until: "2028-09-01",
    });
  });

  it("falls back to the extended date alone", () => {
    expect(check(null, "2026-12-01")).toMatchObject({
      status: "expiring",
      until: "2026-12-01",
    });
  });

  it("crosses a year boundary", () => {
    expect(check("2026-12-31")).toMatchObject({
      status: "expiring",
      daysLeft: 86,
    });
  });
});
