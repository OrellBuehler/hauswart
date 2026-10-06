import { describe, expect, it } from "vitest";
import {
  allocate,
  formatShare,
  minor,
  parseShareBasis,
  parseSharePercent,
  shareOf,
  shareToInput,
} from "./money";

describe("shareOf", () => {
  it("returns the amount unchanged at 100%", () => {
    expect(shareOf(minor(12345), 10000)).toBe(12345);
    expect(shareOf(minor(-12345), 10000)).toBe(-12345);
    expect(shareOf(minor(0), 10000)).toBe(0);
  });

  it.each([
    [10000, 5000, 5000],
    [-10000, 5000, -5000],
    [10000, 7000, 7000],
    [10000, 3333, 3333],
    [0, 3333, 0],
    [12345, 1, 1],
  ])("scales %i at %i bp to %i", (amount, bps, expected) => {
    expect(shareOf(minor(amount), bps)).toBe(expected);
  });

  it("rounds half away from zero for odd minor units", () => {
    expect(shareOf(minor(5), 5000)).toBe(3);
    expect(shareOf(minor(-5), 5000)).toBe(-3);
    expect(shareOf(minor(1), 5000)).toBe(1);
    expect(shareOf(minor(-1), 5000)).toBe(-1);
    expect(shareOf(minor(3), 5000)).toBe(2);
    expect(shareOf(minor(-3), 5000)).toBe(-2);
    expect(shareOf(minor(101), 5000)).toBe(51);
    expect(shareOf(minor(-101), 5000)).toBe(-51);
  });

  it("rounds to the nearest unit otherwise", () => {
    expect(shareOf(minor(10), 3333)).toBe(3);
    expect(shareOf(minor(-10), 3333)).toBe(-3);
    expect(shareOf(minor(100), 6667)).toBe(67);
    expect(shareOf(minor(7), 7000)).toBe(5);
    expect(shareOf(minor(-7), 7000)).toBe(-5);
    expect(shareOf(minor(1), 4999)).toBe(0);
    expect(shareOf(minor(1), 5000)).toBe(1);
  });

  it("is odd: the share of a negative is the negated share of the positive", () => {
    for (const bps of [1, 2500, 3333, 5000, 6667, 7000, 9999]) {
      for (const n of [1, 2, 3, 5, 99, 101, 12345, 999999]) {
        expect(shareOf(minor(-n), bps)).toBe(-shareOf(minor(n), bps));
      }
    }
  });

  it("stays exact for amounts whose product exceeds 2^53", () => {
    expect(shareOf(minor(9_000_000_000_000_000), 5000)).toBe(
      4_500_000_000_000_000,
    );
    expect(shareOf(minor(-9_000_000_000_000_000), 3333)).toBe(
      -2_999_700_000_000_000,
    );
  });

  it("rejects invalid basis points", () => {
    expect(() => shareOf(minor(1), -1)).toThrow(RangeError);
    expect(() => shareOf(minor(1), 0.5)).toThrow(RangeError);
    expect(() => shareOf(minor(1), Number.NaN)).toThrow(RangeError);
  });
});

describe("share percentages", () => {
  it.each([
    ["50", 5000],
    ["100", 10000],
    ["70 %", 7000],
    ["33.33", 3333],
    ["33,3", 3330],
    ["0.01", 1],
    [" 12.5% ", 1250],
  ])("parses %j as %i", (input, bps) => {
    expect(parseSharePercent(input)).toBe(bps);
  });

  it.each([
    "",
    "abc",
    "-5",
    "1.234",
    "50.",
    "1e2",
    "101",
    "100.01",
    "0",
    "0.00",
  ])("rejects %j", (input) => {
    expect(() => parseSharePercent(input)).toThrow();
  });

  it("formats and round-trips", () => {
    expect(formatShare(5000)).toBe("50%");
    expect(formatShare(3333)).toBe("33.33%");
    expect(formatShare(1250)).toBe("12.5%");
    expect(shareToInput(10000)).toBe("100");
    for (const bps of [1, 1250, 3333, 5000, 10000]) {
      expect(parseSharePercent(shareToInput(bps))).toBe(bps);
    }
  });

  it("parses the basis with a fallback", () => {
    expect(parseShareBasis("share", "total")).toBe("share");
    expect(parseShareBasis("total", "share")).toBe("total");
    expect(parseShareBasis("bogus", "share")).toBe("share");
    expect(parseShareBasis(null, "total")).toBe("total");
  });
});

describe("allocate", () => {
  const sum = (parts: number[]) => parts.reduce((a, b) => a + b, 0);

  it.each([
    [10000, [5000, 5000], [5000, 5000]],
    [1001, [5000, 5000], [501, 500]],
    [-1001, [5000, 5000], [-501, -500]],
    [1000, [1, 1, 1], [334, 333, 333]],
    [100, [3333, 3333, 3334], [33, 33, 34]],
    [1, [5000, 5000], [1, 0]],
    [0, [5000, 5000], [0, 0]],
    [12345, [10000], [12345]],
    [7, [7000, 3000], [5, 2]],
  ])("splits %i by %j into %j", (amount, weights, expected) => {
    expect(allocate(minor(amount), weights)).toEqual(expected);
  });

  it("gives the remainder to the largest fractional part, ties to the earlier weight", () => {
    // 10 / 3 = 3.33 each: one extra unit, to the first
    expect(allocate(minor(10), [1, 1, 1])).toEqual([4, 3, 3]);
    // 5 * 0.2 = 1.0, 5 * 0.8 = 4.0: exact
    expect(allocate(minor(5), [2000, 8000])).toEqual([1, 4]);
    // 3 * 0.45 = 1.35, 3 * 0.55 = 1.65: the larger fraction (.65) takes the unit
    expect(allocate(minor(3), [4500, 5500])).toEqual([1, 2]);
  });

  it("never gives anything to a zero weight", () => {
    expect(allocate(minor(5), [0, 1, 1])).toEqual([0, 3, 2]);
    expect(allocate(minor(1), [0, 1, 0])).toEqual([0, 1, 0]);
  });

  it("treats a refund like the expense it reverses", () => {
    for (const amount of [1, 2, 3, 99, 1001, 123457]) {
      const plus = allocate(minor(amount), [3333, 3333, 3334]);
      const minus = allocate(minor(-amount), [3333, 3333, 3334]);
      expect(minus.map((v) => -v + 0)).toEqual(plus);
    }
  });

  it("never returns negative zero", () => {
    expect(Object.is(allocate(minor(-1), [5000, 5000])[1], -0)).toBe(false);
  });

  it("adds up to the amount exactly, whatever the weights (randomised)", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const amount = (rand(2) === 0 ? 1 : -1) * rand(5_000_000);
      const weights = Array.from({ length: 1 + rand(6) }, () => rand(10_000));
      if (sum(weights) === 0) continue;
      const parts = allocate(minor(amount), weights);
      expect(sum(parts)).toBe(amount);
      parts.forEach((part, k) => {
        // within one minor unit of the exact proportion
        const exact = (amount * weights[k]) / sum(weights);
        expect(Math.abs(part - exact)).toBeLessThan(1);
      });
    }
  });

  it("is exact for amounts near the safe integer range", () => {
    const amount = 90_071_992_547_409;
    const parts = allocate(minor(amount), [3333, 3333, 3334]);
    expect(sum(parts)).toBe(amount);
  });

  it("refuses nonsense", () => {
    expect(() => allocate(minor(5), [])).toThrow(RangeError);
    expect(() => allocate(minor(5), [0, 0])).toThrow(RangeError);
    expect(() => allocate(minor(5), [-1, 2])).toThrow(RangeError);
    expect(() => allocate(minor(5), [0.5, 1])).toThrow(RangeError);
  });
});
