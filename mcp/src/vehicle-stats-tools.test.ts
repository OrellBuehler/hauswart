import { describe, expect, it } from "vitest";
import { createVehicle, useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("get_vehicle_stats", () => {
  const mcp = useMcp();

  async function connect(scopes: (typeof ALL)[number][] = [...ALL]) {
    const session = await mcp.connect({ scopes });
    const vehicle = (
      name = "Familienauto",
      plate: string | null = "ZH 000000",
      details: Record<string, unknown> = {},
    ) => createVehicle(session, name, plate, details);
    const fill = (extra: Record<string, unknown>) =>
      session.ok("add_fuel_log", { vehicle: "Familienauto", ...extra });
    return { ...session, vehicle, fill };
  }

  it("is offered to a reader", async () => {
    const { client } = await connect(["read"]);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      "get_vehicle_stats",
    );
  });

  it("counts distance, costs, consumption and prices of a year", async () => {
    const { call, vehicle, fill } = await connect();
    await vehicle();
    await fill({
      date: "2024-03-01",
      odometer: 10_000,
      quantity: 50,
      amount: "90.00",
    });
    await fill({
      date: "2024-03-21",
      odometer: 10_600,
      quantity: 41,
      amount: "73.80",
      station: "Muster Tankstelle",
    });

    const stats = await call("get_vehicle_stats", {
      vehicle: "Familienauto",
      year: 2024,
    });
    expect(stats.summary).toBe(
      "Familienauto, ZH 000000 (2024): 600 km driven; 163.80 CHF in costs (0.273 CHF/km); consumption 6.83 l/100 km.",
    );
    expect(stats.json).toMatchObject({
      vehicle: "Familienauto",
      year: 2024,
      unit: "km",
      distance: 600,
      costs: {
        total: "163.80 CHF",
        count: 2,
        byCategory: [{ category: "fuel", total: "163.80 CHF", count: 2 }],
      },
      costPerDistance: "0.273 CHF/km",
      consumption: [
        {
          unit: "l",
          averagePer100: 6.83,
          stretches: 1,
          last: [
            { date: "2024-03-21", distance: 600, quantity: 41, per100: 6.83 },
          ],
        },
      ],
      priceTrend: [
        { date: "2024-03-01", price: "1.800 CHF/l" },
        { date: "2024-03-21", price: "1.800 CHF/l" },
      ],
    });
    const months = stats.json.distanceByMonth as {
      month: string;
      distance: number;
    }[];
    expect(months).toHaveLength(12);
    expect(months.reduce((sum, m) => sum + m.distance, 0)).toBeCloseTo(600, 0);
  });

  it("covers all time without a year, and a year without any data answers with zeros", async () => {
    const { call, ok, vehicle, fill } = await connect();
    await vehicle();
    await fill({
      date: "2024-03-01",
      odometer: 10_000,
      quantity: 50,
      amount: "90.00",
    });
    await fill({
      date: "2024-05-01",
      odometer: 11_000,
      quantity: 70,
      amount: "126.00",
    });
    const all = await ok("get_vehicle_stats", { vehicle: "Familienauto" });
    expect(all).toMatchObject({
      from: "2024-03-01",
      to: "2024-05-01",
      distance: 1_000,
      costs: { total: "216.00 CHF", count: 2 },
    });
    expect(all.year).toBeUndefined();

    const empty = await call("get_vehicle_stats", {
      vehicle: "Familienauto",
      year: 2019,
    });
    expect(empty.summary).toBe(
      "Familienauto, ZH 000000 (2019): 0 km driven; 0.00 CHF in costs.",
    );
    expect(empty.json).toMatchObject({
      distance: 0,
      costs: { total: "0.00 CHF", count: 0 },
      consumption: [],
      priceTrend: [],
    });
  });

  it("counts the costs of the year asked for only", async () => {
    const { ok, vehicle, fill } = await connect();
    await vehicle();
    await fill({
      date: "2023-06-01",
      odometer: 1_000,
      quantity: 30,
      amount: "50.00",
    });
    await fill({
      date: "2024-03-01",
      odometer: 2_000,
      quantity: 40,
      amount: "70.00",
    });
    const total = async (year?: number) =>
      (await ok("get_vehicle_stats", { vehicle: "Familienauto", year })).costs;
    expect(await total(2024)).toMatchObject({ total: "70.00 CHF", count: 1 });
    expect(await total(2023)).toMatchObject({ total: "50.00 CHF", count: 1 });
    expect(await total()).toMatchObject({ total: "120.00 CHF", count: 2 });
  });

  it("keeps litres and kWh apart for a plug-in hybrid", async () => {
    const { ok, vehicle, fill } = await connect();
    await vehicle("Familienauto", "ZH 000000", { fuelType: "plugin_hybrid" });
    for (const [date, odometer, quantity, unit] of [
      ["2024-03-01", 1_000, 40, "l"],
      ["2024-03-02", 1_050, 10, "kWh"],
      ["2024-03-10", 1_500, 25, "l"],
      ["2024-03-11", 1_600, 14, "kWh"],
    ] as const) {
      await fill({ date, odometer, quantity, unit, amount: "0" });
    }
    const stats = await ok("get_vehicle_stats", {
      vehicle: "Familienauto",
      year: 2024,
    });
    expect(
      stats.consumption.map((c: { unit: string; averagePer100: number }) => [
        c.unit,
        c.averagePer100,
      ]),
    ).toEqual([
      ["kWh", 2.55],
      ["l", 5],
    ]);
  });

  it("shows the mounted tire set and the next tasks of the vehicle only", async () => {
    const { ok, vehicle, day } = await connect();
    await vehicle();
    await vehicle("Roller", "BE 222222");
    await ok("add_tire_set", {
      vehicle: "Familienauto",
      season: "winter",
      brand: "Musterreifen",
    });
    await ok("mount_tire_set", { vehicle: "Familienauto", tireSet: "winter" });
    await ok("create_task", {
      title: "MFK",
      asset: "Familienauto",
      trigger: { type: "one_off", date: day(20) },
    });
    await ok("create_task", {
      title: "Reifen Roller",
      asset: "Roller",
      trigger: { type: "one_off", date: day(20) },
    });
    const stats = await ok("get_vehicle_stats", { vehicle: "Familienauto" });
    expect(stats.tireSet).toMatchObject({
      season: "winter",
      brand: "Musterreifen",
      mounted: true,
    });
    expect(stats.nextTasks).toMatchObject([
      { title: "MFK", date: day(20), asset: "Familienauto" },
    ]);
    const roller = await ok("get_vehicle_stats", { vehicle: "Roller" });
    expect(roller.tireSet).toBeUndefined();
    expect(roller.nextTasks).toMatchObject([{ title: "Reifen Roller" }]);
  });

  it("counts a vehicle in miles in miles", async () => {
    const { ok, vehicle } = await connect();
    await vehicle("Pickup", "ZH 333333", { odometerUnit: "mi" });
    await ok("add_fuel_log", {
      vehicle: "Pickup",
      date: "2024-03-01",
      odometer: 1_000,
      quantity: 20,
      amount: "40",
    });
    await ok("add_fuel_log", {
      vehicle: "Pickup",
      date: "2024-03-10",
      odometer: 1_200,
      quantity: 20,
      amount: "40",
    });
    const stats = await ok("get_vehicle_stats", { vehicle: "Pickup" });
    expect(stats).toMatchObject({ unit: "mi", distance: 200 });
    expect(stats.costPerDistance).toBe("0.400 CHF/mi");
  });

  it("does not take a device for a vehicle", async () => {
    const { call, ok } = await connect();
    await ok("create_asset", { name: "Backofen" });
    const reply = await call("get_vehicle_stats", { vehicle: "Backofen" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("not a vehicle");
  });
});
