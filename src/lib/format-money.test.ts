import { describe, expect, it } from "vitest";
import { readMoney } from "./format-money";

describe("readMoney", () => {
  it.each([
    ["", "CHF", null],
    ["  ", "CHF", null],
    ["34.90", "CHF", 3490],
    ["1'234,5", "CHF", 123450],
    ["12", "JPY", 12],
    ["abc", "CHF", undefined],
    ["1.234", "CHF", undefined],
  ] as const)("reads %j in %s as %s", (text, currency, expected) => {
    expect(readMoney(text, currency)).toBe(expected);
  });
});
