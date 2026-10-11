import { describe, expect, it } from "vitest";
import { pinnableOccurrenceKey } from "./occurrence";

describe("pinnableOccurrenceKey", () => {
  it.each<[string | null | undefined, string | null]>([
    ["2026-06-20", "2026-06-20"],
    ["c:init", "c:init"],
    ["s:1781517600000", "s:1781517600000"],
    ["p:2026-06-01", "p:2026-06-01"],
    ["w:2026-12-31", "w:2026-12-31"],
    ["bill:b1", "bill:b1"],
    ["none", null],
    ["s:none", null],
    [null, null],
    [undefined, null],
  ])("%j -> %j", (key, expected) => {
    expect(pinnableOccurrenceKey(key)).toBe(expected);
  });
});
