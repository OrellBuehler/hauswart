import { describe, expect, it } from "vitest";
import type { FuelFill } from "./fuel";
import {
  averageConsumption,
  averageCostPerDistance,
  fuelStretches,
  pricePerUnitMinor,
} from "./fuel";

let counter = 0;
/** A fill; `[odometer, quantity, ...flags]` keeps the tables short. */
function fill(
  date: string,
  odometer: number,
  quantity: number,
  over: Partial<FuelFill> = {},
): FuelFill {
  counter += 1;
  return {
    id: `f${counter}`,
    date,
    odometer,
    quantity,
    unit: "l",
    amountMinor: Math.round(quantity * 180),
    fullTank: true,
    missedPrevious: false,
    ...over,
  };
}

const values = (fills: FuelFill[]) =>
  fuelStretches(fills).map((s) => [
    s.fillId,
    s.distance,
    s.quantity,
    Math.round(s.consumptionPer100 * 100) / 100,
  ]);

describe("fuelStretches, full to full", () => {
  it("measures nothing before there are two full fills", () => {
    expect(fuelStretches([])).toEqual([]);
    expect(fuelStretches([fill("2026-01-01", 1000, 40)])).toEqual([]);
  });

  it("closes a stretch with every full fill: the closing fill's quantity over the distance", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const b = fill("2026-01-20", 10_600, 40);
    const c = fill("2026-02-10", 11_300, 49);
    expect(values([a, b, c])).toEqual([
      [b.id, 600, 40, 6.67],
      [c.id, 700, 49, 7],
    ]);
  });

  it("adds partial fills up until the next full one", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const p1 = fill("2026-01-10", 10_200, 15, { fullTank: false });
    const p2 = fill("2026-01-18", 10_450, 20, { fullTank: false });
    const b = fill("2026-01-25", 10_700, 10);
    expect(values([a, p1, p2, b])).toEqual([[b.id, 700, 45, 6.43]]);
  });

  it("ignores partial fills before the first full one", () => {
    const p = fill("2025-12-01", 9_800, 30, { fullTank: false });
    const a = fill("2026-01-01", 10_000, 50);
    const b = fill("2026-01-20", 10_500, 35);
    expect(values([p, a, b])).toEqual([[b.id, 500, 35, 7]]);
  });

  it("a partial fill at the end belongs to a stretch that is not closed yet", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const b = fill("2026-01-20", 10_500, 35);
    const p = fill("2026-02-01", 10_800, 20, { fullTank: false });
    expect(values([a, b, p])).toEqual([[b.id, 500, 35, 7]]);
  });

  it("a gap breaks the chain: the fill after it only starts a new one", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const b = fill("2026-01-20", 10_500, 35);
    const c = fill("2026-03-20", 12_500, 80, { missedPrevious: true });
    const d = fill("2026-04-05", 13_000, 36);
    expect(values([a, b, c, d])).toEqual([
      [b.id, 500, 35, 7],
      [d.id, 500, 36, 7.2],
    ]);
  });

  it("a gap flagged on a partial fill drops what was gathered before it", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const p = fill("2026-01-20", 10_400, 20, { fullTank: false });
    const q = fill("2026-02-20", 11_000, 25, {
      fullTank: false,
      missedPrevious: true,
    });
    const b = fill("2026-03-05", 11_500, 30);
    const c = fill("2026-03-25", 12_000, 35);
    // The chain starts again at b, so only c closes a stretch.
    expect(values([a, p, q, b, c])).toEqual([[c.id, 500, 35, 7]]);
    expect(values([a, p, b])).toEqual([[b.id, 1500, 50, 3.33]]);
  });

  it("puts the fills in order of date and odometer, whatever order they come in", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const b = fill("2026-01-20", 10_600, 40);
    const c = fill("2026-02-10", 11_300, 49);
    expect(values([c, a, b])).toEqual(values([a, b, c]).map((row) => row));
  });

  it("orders fills of one day by their odometer", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const late = fill("2026-01-20", 10_650, 10, { fullTank: false });
    const early = fill("2026-01-20", 10_600, 5, { fullTank: false });
    const b = fill("2026-01-21", 10_700, 35);
    expect(values([a, late, early, b])).toEqual([[b.id, 700, 50, 7.14]]);
  });

  it.each([
    ["an odometer that did not go up", 10_000, 0],
    ["an odometer that went down (a replaced cluster)", 400, 0],
  ])(
    "gives no value for %s, and starts again from that fill",
    (_name, odometer) => {
      const a = fill("2026-01-01", 10_000, 50);
      const b = fill("2026-01-20", odometer, 35);
      const c = fill("2026-02-10", odometer + 500, 30);
      expect(values([a, b, c])).toEqual([[c.id, 500, 30, 6]]);
    },
  );

  it("keeps litres and kilowatt hours apart", () => {
    const l1 = fill("2026-01-01", 10_000, 40);
    const e1 = fill("2026-01-05", 10_100, 20, { unit: "kWh" });
    const l2 = fill("2026-01-20", 10_800, 32);
    const e2 = fill("2026-01-25", 10_400, 25, { unit: "kWh" });
    const result = fuelStretches([l1, e1, l2, e2]);
    expect(result.map((s) => [s.unit, s.distance, s.quantity])).toEqual([
      ["l", 800, 32],
      ["kWh", 300, 25],
    ]);
  });

  it("returns the stretches in time order across units", () => {
    const e1 = fill("2026-01-01", 1_000, 10, { unit: "kWh" });
    const e2 = fill("2026-02-01", 1_100, 10, { unit: "kWh" });
    const l1 = fill("2026-01-02", 1_000, 10);
    const l2 = fill("2026-01-10", 1_200, 10);
    expect(fuelStretches([e1, e2, l1, l2]).map((s) => s.fillId)).toEqual([
      l2.id,
      e2.id,
    ]);
  });
});

describe("cost per distance", () => {
  it("is the amounts of the stretch over its distance", () => {
    const a = fill("2026-01-01", 10_000, 50, { amountMinor: 9_000 });
    const p = fill("2026-01-10", 10_200, 10, {
      amountMinor: 1_900,
      fullTank: false,
    });
    const b = fill("2026-01-25", 10_600, 30, { amountMinor: 5_300 });
    const [s] = fuelStretches([a, p, b]);
    expect(s.amountMinor).toBe(7_200);
    expect(s.costPerDistanceMinor).toBe(12);
  });

  it("is unknown when any amount of the stretch is", () => {
    const a = fill("2026-01-01", 10_000, 50);
    const p = fill("2026-01-10", 10_200, 10, {
      amountMinor: null,
      fullTank: false,
    });
    const b = fill("2026-01-25", 10_600, 30);
    const [s] = fuelStretches([a, p, b]);
    expect(s.amountMinor).toBeNull();
    expect(s.costPerDistanceMinor).toBeNull();
  });

  it("a free charge costs nothing", () => {
    const a = fill("2026-01-01", 10_000, 10, { unit: "kWh", amountMinor: 0 });
    const b = fill("2026-01-10", 10_100, 15, { unit: "kWh", amountMinor: 0 });
    expect(fuelStretches([a, b])[0].costPerDistanceMinor).toBe(0);
  });
});

describe("averages", () => {
  const a = fill("2026-01-01", 10_000, 50, { amountMinor: 9_000 });
  const b = fill("2026-01-20", 10_100, 10, { amountMinor: 1_800 }); // 10 l/100 km over 100 km
  const c = fill("2026-02-20", 11_100, 60, { amountMinor: 9_000 }); // 6 l/100 km over 1000 km
  const stretches = fuelStretches([a, b, c]);

  it("weighs a stretch by its distance", () => {
    expect(averageConsumption(stretches)).toBeCloseTo((70 / 1100) * 100, 9);
    // The plain mean of 10 and 6 would be 8.
    expect(averageConsumption(stretches)).not.toBeCloseTo(8, 1);
  });

  it("averages the cost per distance over the stretches whose cost is known", () => {
    expect(averageCostPerDistance(stretches)).toBeCloseTo(10_800 / 1100, 9);
    const unknown = fuelStretches([
      a,
      fill("2026-01-20", 10_100, 10, { amountMinor: null }),
    ]);
    expect(averageCostPerDistance(unknown)).toBeNull();
    expect(averageCostPerDistance([...unknown, ...stretches])).toBeCloseTo(
      10_800 / 1100,
      9,
    );
  });

  it("has no average without a stretch", () => {
    expect(averageConsumption([])).toBeNull();
    expect(averageCostPerDistance([])).toBeNull();
  });
});

describe("pricePerUnitMinor", () => {
  it.each([
    [18_500, 100, 185],
    [7_300, 40, 182.5],
    [0, 20, 0],
    [null, 20, null],
    [1_000, 0, null],
  ])("%s for %s", (amountMinor, quantity, expected) => {
    expect(pricePerUnitMinor({ amountMinor, quantity })).toBe(expected);
  });
});
