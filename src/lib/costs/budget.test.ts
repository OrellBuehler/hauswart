import { describe, expect, it } from "vitest";
import { budgetRange, budgetUsage } from "./budget";

describe("budgetRange", () => {
  it.each<["month" | "year", number, number, string, string]>([
    ["month", 2026, 1, "2026-01-01", "2026-01-31"],
    ["month", 2026, 2, "2026-02-01", "2026-02-28"],
    ["month", 2028, 2, "2028-02-01", "2028-02-29"],
    ["month", 2026, 4, "2026-04-01", "2026-04-30"],
    ["month", 2026, 12, "2026-12-01", "2026-12-31"],
    ["year", 2026, 5, "2026-01-01", "2026-12-31"],
    ["year", 2028, 1, "2028-01-01", "2028-12-31"],
  ])("%s %i-%i is %s to %s", (period, year, month, from, to) => {
    expect(budgetRange(period, year, month)).toEqual({ from, to });
  });
});

describe("budgetUsage", () => {
  it.each<
    [string, number, number, number, number, "ok" | "warning" | "exceeded"]
  >([
    ["nothing spent", 0, 100000, 100000, 0, "ok"],
    ["a little", 1, 100000, 99999, 0, "ok"],
    ["79 percent", 79000, 100000, 21000, 79, "ok"],
    ["just below 80 percent", 79999, 100000, 20001, 79, "ok"],
    ["exactly 80 percent", 80000, 100000, 20000, 80, "warning"],
    ["99 percent", 99000, 100000, 1000, 99, "warning"],
    ["just below the whole amount", 99999, 100000, 1, 99, "warning"],
    ["exactly the whole amount", 100000, 100000, 0, 100, "exceeded"],
    ["one over", 100001, 100000, -1, 100, "exceeded"],
    ["double", 200000, 100000, -100000, 200, "exceeded"],
    ["refunds exceed the spending", -5000, 100000, 105000, 0, "ok"],
    ["a budget of one minor unit, spent", 1, 1, 0, 100, "exceeded"],
    ["a budget of five minor units at 80 percent", 4, 5, 1, 80, "warning"],
    ["a budget of five minor units just below", 3, 5, 2, 60, "ok"],
    [
      "amounts far beyond 32 bits",
      8_000_000_000_00,
      10_000_000_000_00,
      2_000_000_000_00,
      80,
      "warning",
    ],
  ])("%s", (_name, spent, amount, remaining, percent, state) => {
    expect(budgetUsage(spent, amount)).toEqual({
      remainingMinor: remaining,
      percentUsed: percent,
      state,
    });
  });

  it("takes another warning percentage", () => {
    expect(budgetUsage(50, 100, 50).state).toBe("warning");
    expect(budgetUsage(49, 100, 50).state).toBe("ok");
  });
});
