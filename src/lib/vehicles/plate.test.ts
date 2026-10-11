import { describe, expect, it } from "vitest";
import { plateKey } from "./plate";

describe("plateKey", () => {
  it.each([
    ["ZH 000000", "zh000000"],
    ["zh-000000", "zh000000"],
    ["ZH.000 000", "zh000000"],
    ["  Zh000000 ", "zh000000"],
    ["BE 0 001", "be0001"],
    ["", ""],
    ["--", ""],
  ])("%j -> %j", (plate, key) => {
    expect(plateKey(plate)).toBe(key);
  });
});
