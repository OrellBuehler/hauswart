import { describe, expect, it } from "vitest";
import {
  formatOdometer,
  parseDecimalInput,
  parseOdometerValue,
} from "./format";

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

  it.each([
    ["95.000", 95000],
    ["95,000", 95000],
    ["95'000", 95000],
    ["95’000", 95000],
    ["95 000", 95000],
    ["95\u2009000", 95000],
    ["95\u202f000", 95000],
    ["95\u00a0000", 95000],
    ["1.000", 1000],
    ["12.345", 12345],
    ["123.456", 123456],
    ["1.234.567", 1234567],
    ["1,234,567", 1234567],
    ["1'234'567", 1234567],
    ["9.999.999", 9999999],
  ])("reads %j as a group separator: %j", (text, expected) => {
    expect(parseOdometerValue(text, MAX)).toBe(expected);
  });

  it.each([
    ["95.50", 95.5],
    ["95,5", 95.5],
    ["95.5000", 95.5],
    ["95.0", 95],
    ["0.500", 0.5],
    ["0,000", 0],
    ["45200.5", 45200.5],
    ["1.5", 1.5],
  ])("keeps %j as a decimal reading: %j", (text, expected) => {
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
    "1.234,567",
    "1,234.567",
    "1.2345.678",
    "1..000",
    "95.000.",
    ".000",
    String(MAX + 1),
    "10.000.001",
  ])("is undefined for %j: not a reading", (text) => {
    expect(parseOdometerValue(text, MAX)).toBeUndefined();
  });
});

describe("parseDecimalInput", () => {
  it.each([
    ["95.000", 95],
    ["95,000", 95],
    ["1,234", 1.234],
    ["41.23", 41.23],
    ["38,5", 38.5],
    ["7.5", 7.5],
    ["1'234", 1234],
    ["1 234,5", 1234.5],
    ["0", 0],
  ])(
    "keeps the decimals of %j for amounts and litres: %j",
    (text, expected) => {
      expect(parseDecimalInput(text, MAX)).toBe(expected);
    },
  );

  it("is null when empty and undefined for text that is no number or too large", () => {
    expect(parseDecimalInput("  ", MAX)).toBeNull();
    expect(parseDecimalInput("1.234.567", MAX)).toBeUndefined();
    expect(parseDecimalInput("abc", MAX)).toBeUndefined();
    expect(parseDecimalInput("-1", MAX)).toBeUndefined();
    expect(parseDecimalInput(String(MAX + 1), MAX)).toBeUndefined();
  });
});
