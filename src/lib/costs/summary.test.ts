import { describe, expect, it } from "vitest";
import { hasSettlementData, shareBps, taxTotal } from "./summary";

const person = (paidMinor: number, shareMinor: number) => ({
  userId: "u",
  userName: null,
  paidMinor,
  shareMinor,
  balanceMinor: paidMinor - shareMinor,
});

describe("hasSettlementData", () => {
  it("is false without people or when nobody paid or bears anything", () => {
    expect(hasSettlementData({ people: [] })).toBe(false);
    expect(hasSettlementData({ people: [person(0, 0), person(0, 0)] })).toBe(
      false,
    );
  });

  it("is true as soon as somebody paid or bears a share", () => {
    expect(hasSettlementData({ people: [person(500, 0)] })).toBe(true);
    expect(hasSettlementData({ people: [person(0, 250)] })).toBe(true);
    expect(hasSettlementData({ people: [person(-500, -500)] })).toBe(true);
  });
});

describe("the tax breakdown", () => {
  const rows = [
    { deductible: "maintenance" as const, totalMinor: 20000, count: 2 },
    { deductible: "investment" as const, totalMinor: 20000, count: 1 },
    { deductible: "unknown" as const, totalMinor: -5000, count: 1 },
  ];

  it("adds up what the breakdown holds, which only tax relevant books are in", () => {
    expect(taxTotal({ byDeductible: rows })).toBe(35000);
    expect(taxTotal({ byDeductible: [] })).toBe(0);
  });

  it("takes a share of a whole in basis points, rounded, and none of nothing", () => {
    expect(shareBps(20000, 40000)).toBe(5000);
    expect(shareBps(1, 3)).toBe(3333);
    expect(shareBps(5, 0)).toBeNull();
    expect(shareBps(5, -10)).toBeNull();
  });

  it("measures the rows against the breakdown, not against all the year's expenses", () => {
    const expenseTotalMinor = 200000;
    const whole = taxTotal({ byDeductible: rows.slice(0, 2) });
    expect(shareBps(20000, whole)).toBe(5000);
    expect(shareBps(20000, expenseTotalMinor)).toBe(1000);
  });
});
