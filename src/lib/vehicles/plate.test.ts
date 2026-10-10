import { describe, expect, it } from "vitest";
import { plateKey } from "./plate";

describe("plateKey", () => {
  it.each([
    ["ZH 000000", "zh000000"],
    ["zh-000000", "zh000000"],
    ["ZH.000 000", "zh000000"],
    ["  Zh000000 ", "zh000000"],
    ["BE 1 234", "be1234"],
    ["", ""],
    ["--", ""],
  ])("%j -> %j", (plate, key) => {
    expect(plateKey(plate)).toBe(key);
  });
});
