import { describe, expect, it } from "vitest";
import { stockLevel } from "./stock";

describe("stockLevel", () => {
  it.each([
    [0, 0, "empty"],
    [0, 3, "empty"],
    [1, 0, "ok"],
    [3, 3, "low"],
    [2, 3, "low"],
    [4, 3, "ok"],
  ] as const)(
    "stock %i with minimum %i is %s",
    (stockCount, minStock, level) => {
      expect(stockLevel({ stockCount, minStock })).toBe(level);
    },
  );
});
