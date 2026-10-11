import { describe, expect, it } from "vitest";
import { priceSeries, sparkline } from "./trend";

const series = (...values: number[]) =>
  values.map((value, i) => ({
    date: `2026-0${i + 1}-15`,
    value,
  }));

describe("sparkline", () => {
  it("shows no trend for fewer than two points", () => {
    expect(sparkline([], 100, 40)).toBeNull();
    expect(sparkline(series(1.8), 100, 40)).toBeNull();
  });

  it("spreads the points evenly over the width and puts the highest on top", () => {
    const chart = sparkline(series(1, 3, 2), 100, 40, 4);
    expect(chart?.dots.map((d) => d.x)).toEqual([4, 50, 96]);
    expect(chart?.dots.map((d) => d.y)).toEqual([36, 4, 20]);
    expect(chart?.line).toBe("M4 36 L50 4 L96 20");
  });

  it("closes the area down to the bottom edge", () => {
    const chart = sparkline(series(1, 3, 2), 100, 40, 4);
    expect(chart?.area).toBe("M4 36 L50 4 L96 20 L96 36 L4 36 Z");
  });

  it("runs a flat series through the middle", () => {
    const chart = sparkline(series(1.5, 1.5, 1.5), 100, 40);
    expect(chart?.dots.map((d) => d.y)).toEqual([20, 20, 20]);
  });

  it("reports the ends and the extremes", () => {
    const points = series(1.9, 1.7, 2.1, 1.8);
    const chart = sparkline(points, 100, 40);
    expect(chart?.first).toBe(points[0]);
    expect(chart?.last).toBe(points[3]);
    expect(chart?.min).toBe(points[1]);
    expect(chart?.max).toBe(points[2]);
  });
});

describe("priceSeries", () => {
  const trend = [
    { fillId: "a", date: "2026-01-02", unit: "l", pricePerUnitMinor: 180 },
    { fillId: "b", date: "2026-01-09", unit: "kWh", pricePerUnitMinor: 31 },
    { fillId: "c", date: "2026-02-01", unit: "l", pricePerUnitMinor: 0 },
    { fillId: "d", date: "2026-02-10", unit: "l", pricePerUnitMinor: 184.7 },
  ];

  it("keeps the fills of one unit in order", () => {
    expect(priceSeries(trend, "kWh")).toEqual([
      { date: "2026-01-09", value: 31 },
    ]);
  });

  it("leaves out a free charge, which is no price", () => {
    expect(priceSeries(trend, "l")).toEqual([
      { date: "2026-01-02", value: 180 },
      { date: "2026-02-10", value: 184.7 },
    ]);
  });
});
