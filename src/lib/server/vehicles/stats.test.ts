import { describe, expect, it } from "vitest";
import { addDays } from "$lib/dates";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createFuelLogRequestSchema } from "$lib/api/schemas/fuel-logs";
import { createTireSetRequestSchema } from "$lib/api/schemas/tire-sets";
import { createAsset } from "$lib/server/assets/assets";
import { createCost } from "$lib/server/costs/costs";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, makeTask, NOW } from "$lib/testing/domain";
import { failure, makeVehicle } from "$lib/testing/vehicles";
import { createFuelLog } from "./fuel-logs";
import { recordOdometer } from "./odometer";
import { LAST_CONSUMPTION_VALUES, NEXT_TASKS, vehicleStats } from "./stats";
import { createTireSet, mountTireSet } from "./tires";

describe("vehicle statistics", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const stats = (assetId: string, year?: number) =>
    vehicleStats(ctx(), assetId, year);
  const reading = (assetId: string, date: string, value: number) =>
    recordOdometer(ctx(), { assetId, date, value, source: "manual" });
  const book = (assetId: string | null, over: Record<string, unknown> = {}) =>
    createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Eintrag",
        amountMinor: 10_000,
        category: "repair",
        date: "2026-03-10",
        assetId,
        ...over,
      }),
      null,
    );
  const fill = (
    assetId: string,
    date: string,
    odometer: number,
    quantity: number,
    over: Record<string, unknown> = {},
  ) =>
    createFuelLog(
      ctx(),
      assetId,
      createFuelLogRequestSchema.parse({
        date,
        odometer,
        quantity,
        amountMinor: Math.round(quantity * 180),
        ...over,
      }),
      null,
    );

  it("is complete but empty for a vehicle without anything", async () => {
    const car = makeVehicle(test);
    expect(await stats(car.id)).toMatchObject({
      assetId: car.id,
      year: null,
      from: null,
      to: null,
      odometerUnit: "km",
      distance: 0,
      distanceByMonth: [],
      costs: {
        currency: "CHF",
        totalMinor: 0,
        count: 0,
        otherCurrencyCount: 0,
        byCategory: [],
      },
      costPerDistanceMinor: null,
      consumption: [],
      priceTrend: [],
      tireSet: null,
      nextTasks: [],
    });
    const year = await stats(car.id, 2026);
    expect(year).toMatchObject({
      year: 2026,
      from: "2026-01-01",
      to: "2026-12-31",
      distance: 0,
    });
    expect(year.distanceByMonth).toHaveLength(12);
  });

  it("works out the distance of a year, and of all time, from the readings", async () => {
    const car = makeVehicle(test);
    await reading(car.id, "2025-12-01", 9_000);
    await reading(car.id, "2026-01-01", 10_000);
    await reading(car.id, "2026-03-01", 12_950);
    const all = await stats(car.id);
    expect(all).toMatchObject({
      from: "2025-12-01",
      to: "2026-03-01",
      distance: 3_950,
    });
    expect(all.distanceByMonth.map((m) => m.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    const y2026 = await stats(car.id, 2026);
    // The first day of the year still belongs to the stretch that began in December.
    expect(y2026.distance).toBe(2_982.3);
    expect(y2026.distanceByMonth.map((m) => m.distance)).toEqual([
      1_532.3, 1_400, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect((await stats(car.id, 2025)).distance).toBe(967.7);
    expect((await stats(car.id, 2024)).distance).toBe(0);
  });

  it("adds up the cost entries of the vehicle that count as an expense, in the household currency", async () => {
    const car = makeVehicle(test);
    const other = makeVehicle(test, "Zweitwagen");
    await reading(car.id, "2026-01-01", 10_000);
    await reading(car.id, "2026-03-01", 12_950);
    book(car.id, { amountMinor: 20_000 });
    book(car.id, {
      amountMinor: 5_000,
      category: "insurance",
      date: "2026-05-01",
    });
    book(car.id, { amountMinor: 3_000, category: "fuel", date: "2025-12-24" });
    book(car.id, { amountMinor: 9_000, currency: "EUR" });
    book(car.id, {
      amountMinor: 40_000,
      category: "purchase",
      countsAsExpense: false,
    });
    book(other.id, { amountMinor: 77_000 });
    book(null, { amountMinor: 66_000 });

    const y2026 = await stats(car.id, 2026);
    expect(y2026.costs).toEqual({
      currency: "CHF",
      totalMinor: 25_000,
      count: 2,
      otherCurrencyCount: 1,
      byCategory: [
        { category: "repair", totalMinor: 20_000, count: 1 },
        { category: "insurance", totalMinor: 5_000, count: 1 },
      ],
    });
    expect(y2026.costPerDistanceMinor).toBeCloseTo(25_000 / 2_950, 9);
    const all = await stats(car.id);
    expect(all.costs.totalMinor).toBe(28_000);
    expect(all.costs.byCategory.map((c) => c.category)).toEqual([
      "repair",
      "insurance",
      "fuel",
    ]);
    expect((await stats(car.id, 2024)).costs.totalMinor).toBe(0);
  });

  it("has no cost per distance without a distance", async () => {
    const car = makeVehicle(test);
    book(car.id);
    expect((await stats(car.id, 2026)).costPerDistanceMinor).toBeNull();
  });

  it("gives the consumption of the stretches closed in the period, the last ten, oldest first", async () => {
    const car = makeVehicle(test);
    fill(car.id, "2025-12-01", 9_000, 40);
    // Twelve stretches of 500 km; the n-th uses 30 + n litres.
    for (let n = 1; n <= 12; n += 1) {
      fill(car.id, addDays("2026-01-01", n * 10), 9_000 + n * 500, 30 + n);
    }
    const all = await stats(car.id);
    expect(all.consumption).toHaveLength(1);
    const [litres] = all.consumption;
    expect(litres).toMatchObject({ unit: "l", stretchCount: 12 });
    expect(litres.last).toHaveLength(LAST_CONSUMPTION_VALUES);
    expect(litres.last.map((s) => s.quantity)).toEqual([
      33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
    ]);
    expect(litres.last[0].consumptionPer100).toBeCloseTo((33 / 500) * 100, 9);
    // 30 + 1 ... 30 + 12 litres over 12 x 500 km.
    expect(litres.averagePer100).toBeCloseTo(((12 * 30 + 78) / 6_000) * 100, 9);

    const march = await stats(car.id, 2026);
    expect(march.consumption[0].stretchCount).toBe(12);
    expect((await stats(car.id, 2025)).consumption).toEqual([]);
  });

  it("keeps litres and kilowatt hours apart for a plug-in hybrid", async () => {
    const car = makeVehicle(test);
    fill(car.id, "2026-01-01", 10_000, 40);
    fill(car.id, "2026-01-05", 10_100, 10, { unit: "kWh", amountMinor: 300 });
    fill(car.id, "2026-01-20", 10_800, 32);
    fill(car.id, "2026-01-25", 10_900, 20, { unit: "kWh", amountMinor: 600 });
    const { consumption } = await stats(car.id);
    expect(consumption.map((c) => [c.unit, c.stretchCount])).toEqual([
      ["kWh", 1],
      ["l", 1],
    ]);
  });

  it("lists the price of a unit over the fills, in the household currency, the last 24", async () => {
    const car = makeVehicle(test);
    for (let n = 0; n < 26; n += 1) {
      fill(car.id, "2026-02-10", 10_000 + n * 100, 40, {
        amountMinor: 7_000 + n * 40,
      });
    }
    fill(car.id, "2026-03-01", 20_000, 40, { currency: "EUR" });
    const { priceTrend } = await stats(car.id);
    expect(priceTrend).toHaveLength(24);
    expect(priceTrend[0].pricePerUnitMinor).toBeCloseTo(
      (7_000 + 2 * 40) / 40,
      9,
    );
    expect(priceTrend.at(-1)?.pricePerUnitMinor).toBeCloseTo(
      (7_000 + 25 * 40) / 40,
      9,
    );
    expect(priceTrend.every((p) => p.unit === "l")).toBe(true);
    expect((await stats(car.id, 2025)).priceTrend).toEqual([]);
  });

  it("names the tire set the vehicle runs on", async () => {
    const car = makeVehicle(test);
    const winter = createTireSet(
      ctx(),
      car.id,
      createTireSetRequestSchema.parse({ season: "winter", brand: "Muster" }),
    );
    expect((await stats(car.id)).tireSet).toBeNull();
    mountTireSet(ctx(), car.id, winter.id, {}, null);
    expect((await stats(car.id)).tireSet).toMatchObject({
      id: winter.id,
      brand: "Muster",
      mounted: true,
    });
  });

  it("shows the next tasks of the vehicle only, overdue first, at most five", async () => {
    const car = makeVehicle(test);
    const other = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    await makeTask(ctx(), {
      title: "Fremd",
      assetId: other.id,
      trigger: { v: 1, type: "one_off", date: "2026-06-01" },
    });
    await makeTask(ctx(), {
      title: "Ohne Fahrzeug",
      trigger: { v: 1, type: "one_off", date: "2026-06-01" },
    });
    for (let n = 0; n < 7; n += 1) {
      await makeTask(ctx(), {
        title: `Aufgabe ${n}`,
        assetId: car.id,
        trigger: {
          v: 1,
          type: "one_off",
          date: `2026-0${n < 2 ? 5 : 7}-${10 + n}`,
        },
      });
    }
    const { nextTasks } = await stats(car.id);
    expect(nextTasks).toHaveLength(NEXT_TASKS);
    expect(nextTasks.map((t) => t.title)).toEqual([
      "Aufgabe 0",
      "Aufgabe 1",
      "Aufgabe 2",
      "Aufgabe 3",
      "Aufgabe 4",
    ]);
    expect(nextTasks[0]).toMatchObject({
      status: "overdue",
      assetId: car.id,
      assetName: "Testauto",
    });
  });

  it("an asset that is no vehicle, or does not exist, has no statistics", async () => {
    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    expect((await failure(() => stats(device.id))).code).toBe("not_found");
    expect((await failure(() => stats("nope"))).code).toBe("not_found");
  });
});
