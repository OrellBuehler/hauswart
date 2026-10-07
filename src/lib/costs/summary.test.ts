import { describe, expect, it } from "vitest";
import { hasSettlementData } from "./summary";

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
