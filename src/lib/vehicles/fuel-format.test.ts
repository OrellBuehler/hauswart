import { describe, expect, it } from "vitest";
import {
  formatConsumption,
  formatFuelQuantity,
  formatRate,
} from "./fuel-format";

describe("formatConsumption", () => {
  it("shows one decimal and the unit per 100 distance units", () => {
    expect(formatConsumption(7.44, "l", "km")).toBe("7.4 l/100 km");
    expect(formatConsumption(16.5, "kWh", "km")).toBe("16.5 kWh/100 km");
    expect(formatConsumption(9, "l", "mi")).toBe("9.0 l/100 mi");
  });

  it("rounds to the shown decimal", () => {
    expect(formatConsumption(7.46, "l", "km")).toBe("7.5 l/100 km");
  });
});

describe("formatFuelQuantity", () => {
  it("names the unit and keeps at most two decimals", () => {
    expect(formatFuelQuantity(41.234, "l")).toBe("41.23 l");
    expect(formatFuelQuantity(38, "kWh")).toBe("38 kWh");
  });
});

describe("formatRate", () => {
  it("shows a rate in minor units with one digit more than an amount", () => {
    expect(formatRate(184.7, "CHF", "l")).toMatch(/^CHF.1[.,]847\/l$/);
    expect(formatRate(12.34, "EUR", "km")).toMatch(/0[.,]123\/km$/);
  });

  it("follows the currency's own precision", () => {
    expect(formatRate(172.6, "JPY", "l")).toMatch(/172[.,]6\/l$/);
  });
});
