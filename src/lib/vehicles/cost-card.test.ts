import { describe, expect, it } from "vitest";
import { parseCostFilters } from "$lib/costs/filters";
import { costShare, statsYears, vehicleCostsQuery } from "./cost-card";

describe("statsYears", () => {
  it("runs from this year back to the earliest date the vehicle is known from", () => {
    expect(statsYears("2026-10-11", ["2023-05-02"])).toEqual([
      2026, 2025, 2024, 2023,
    ]);
    expect(
      statsYears("2026-10-11", ["2024-01-12", "2022-03-10", null]),
    ).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it("offers this year and the one before whatever it knows", () => {
    expect(statsYears("2026-10-11", [])).toEqual([2026, 2025]);
    expect(statsYears("2026-10-11", [null, undefined])).toEqual([2026, 2025]);
    expect(statsYears("2026-10-11", ["2026-01-03"])).toEqual([2026, 2025]);
  });

  it("does not go back more than twenty years", () => {
    const years = statsYears("2026-10-11", ["1990-01-01"]);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(2006);
    expect(years).toHaveLength(21);
  });

  it("copes with a date after today and with one that is no date", () => {
    expect(statsYears("2026-10-11", ["2027-01-01"])).toEqual([2026, 2025]);
    expect(statsYears("2026-10-11", ["soon"])).toEqual([2026, 2025]);
  });
});

describe("costShare", () => {
  it("is the part of the total in whole percent", () => {
    expect(costShare(20000, 5000)).toBe(25);
    expect(costShare(30000, 10000)).toBe(33);
  });

  it("is 0 for an empty total", () => {
    expect(costShare(0, 0)).toBe(0);
  });
});

describe("vehicleCostsQuery", () => {
  it("is read back by the costs page as the asset and the year", () => {
    const query = vehicleCostsQuery("a b", 2025);
    const filters = parseCostFilters(new URLSearchParams(query), 2026);
    expect(filters.assetId).toBe("a b");
    expect(filters.year).toBe(2025);
  });
});
