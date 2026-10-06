import { describe, expect, it } from "vitest";
import { amountsFor, sharesFor } from "./split";

const people = (...bps: number[]) =>
  bps.map((ownershipBps, i) => ({ id: `u${i + 1}`, ownershipBps }));

describe("sharesFor", () => {
  it("splits by ownership", () => {
    expect(sharesFor("ownership", people(5000, 5000))).toEqual([
      { userId: "u1", shareBps: 5000 },
      { userId: "u2", shareBps: 5000 },
    ]);
    expect(sharesFor("ownership", people(7000, 3000))).toEqual([
      { userId: "u1", shareBps: 7000 },
      { userId: "u2", shareBps: 3000 },
    ]);
  });

  it("normalises ownership that does not add up to 100%", () => {
    expect(sharesFor("ownership", people(2500, 2500))).toEqual([
      { userId: "u1", shareBps: 5000 },
      { userId: "u2", shareBps: 5000 },
    ]);
    const thirds = sharesFor("ownership", people(1000, 1000, 1000));
    expect(thirds.reduce((a, s) => a + s.shareBps, 0)).toBe(10000);
    expect(thirds.map((s) => s.shareBps)).toEqual([3334, 3333, 3333]);
  });

  it("leaves out people without a share, and falls back to equal when nobody has one", () => {
    expect(sharesFor("ownership", people(10000, 0))).toEqual([
      { userId: "u1", shareBps: 10000 },
    ]);
    expect(sharesFor("ownership", people(0, 0))).toEqual([
      { userId: "u1", shareBps: 5000 },
      { userId: "u2", shareBps: 5000 },
    ]);
  });

  it("splits equally whatever the ownership", () => {
    expect(sharesFor("equal", people(9000, 1000))).toEqual([
      { userId: "u1", shareBps: 5000 },
      { userId: "u2", shareBps: 5000 },
    ]);
  });

  it("is empty for none and for nobody", () => {
    expect(sharesFor("none", people(5000, 5000))).toEqual([]);
    expect(sharesFor("equal", [])).toEqual([]);
  });

  it("does not depend on the order the people come in", () => {
    const a = sharesFor("ownership", people(1000, 1000, 1000));
    const b = sharesFor("ownership", [...people(1000, 1000, 1000)].reverse());
    expect(b).toEqual(a);
  });
});

describe("amountsFor", () => {
  it("adds up to the amount exactly", () => {
    const shares = sharesFor("ownership", people(3333, 3333, 3334));
    for (const amount of [1, 2, 100, 1001, 99999, -1001]) {
      const parts = amountsFor(amount, shares);
      expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(amount);
    }
  });

  it("gives odd minor units to the larger fraction", () => {
    expect(
      amountsFor(1001, sharesFor("ownership", people(5000, 5000))),
    ).toEqual([
      { userId: "u1", shareBps: 5000, amountMinor: 501 },
      { userId: "u2", shareBps: 5000, amountMinor: 500 },
    ]);
  });

  it("is empty without shares", () => {
    expect(amountsFor(500, [])).toEqual([]);
  });
});
