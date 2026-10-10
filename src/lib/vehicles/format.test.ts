import { describe, expect, it } from "vitest";
import { formatOdometer, parseOdometerValue } from "./format";

const MAX = 10_000_000;

describe("formatOdometer", () => {
  it("groups thousands and names the unit", () => {
    expect(formatOdometer(45200, "km")).toMatch(/^45.200 km$/);
    expect(formatOdometer(120, "mi")).toBe("120 mi");
    expect(formatOdometer(0, "km")).toBe("0 km");
  });

  it("keeps a decimal reading short", () => {
    expect(formatOdometer(45200.5, "km")).toMatch(/^45.200[.,]5 km$/);
  });
});

describe("parseOdometerValue", () => {
  it.each([
    ["45200", 45200],
    ["  45200  ", 45200],
    ["45'200", 45200],
    ["45’200", 45200],
    ["45 200", 45200],
    ["45200.5", 45200.5],
    ["45200,5", 45200.5],
    ["0", 0],
    [String(MAX), MAX],
  ])("reads %j as %j", (text, expected) => {
    expect(parseOdometerValue(text, MAX)).toBe(expected);
  });

  it("is null for an empty field: nothing was entered", () => {
    expect(parseOdometerValue("", MAX)).toBeNull();
    expect(parseOdometerValue("   ", MAX)).toBeNull();
  });

  it.each([
    "abc",
    "-5",
    "+5",
    "4 5 abc",
    "45200.",
    "1e3",
    "45.200.5",
    String(MAX + 1),
  ])("is undefined for %j: not a reading", (text) => {
    expect(parseOdometerValue(text, MAX)).toBeUndefined();
  });
});
