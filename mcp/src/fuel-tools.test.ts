import { describe, expect, it } from "vitest";
import { createVehicle, useMcp } from "./test-harness";

const ALL = ["read", "write", "costs:write"] as const;

describe("fuel log tools", () => {
  const mcp = useMcp();

  async function connect(scopes: (typeof ALL)[number][] = [...ALL]) {
    const session = await mcp.connect({ scopes });
    return {
      ...session,
      vehicle: (
        name = "Familienauto",
        plate: string | null = "ZH 000000",
        details: Record<string, unknown> = {},
      ) => createVehicle(session, name, plate, details),
    };
  }

  it("offers add_fuel_log with costs:write and list_fuel_logs with read", async () => {
    const names = async (scopes: (typeof ALL)[number][]) =>
      (await (await connect(scopes)).client.listTools()).tools.map(
        (t) => t.name,
      );
    const reader = await names(["read"]);
    expect(reader).toContain("list_fuel_logs");
    expect(reader).not.toContain("add_fuel_log");
    expect(await names(["read", "write"])).not.toContain("add_fuel_log");
    expect(await names([...ALL])).toEqual(
      expect.arrayContaining(["add_fuel_log", "list_fuel_logs"]),
    );
  });

  it("logs a fill-up for a vehicle given by plate: the log, the reading and the cost entry", async () => {
    const { ok, vehicle, day } = await connect();
    const id = await vehicle();
    const fill = await ok("add_fuel_log", {
      vehicle: "zh000000",
      date: day(-3),
      odometer: 80_000,
      quantity: 41.2,
      amount: "74.16",
      station: "Muster Tankstelle",
    });
    expect(fill).toMatchObject({
      vehicle: "Familienauto",
      vehicleId: id,
      date: day(-3),
      odometer: 80_000,
      odometerUnit: "km",
      quantity: 41.2,
      unit: "l",
      amount: "74.16 CHF",
      pricePerUnit: "1.800 CHF/l",
      station: "Muster Tankstelle",
    });
    expect(fill.fullTank).toBeUndefined();
    expect(fill.consumptionPer100).toBeUndefined();

    const costs = await ok("list_costs", { asset: "Familienauto" });
    expect(costs.costs).toMatchObject([
      {
        id: fill.costEntryId,
        title: "Tanken Muster Tankstelle",
        amount: "74.16 CHF",
        category: "fuel",
        payee: "Muster Tankstelle",
        paidBy: "Anna",
        split: "ownership",
        asset: "Familienauto",
        date: day(-3),
      },
    ]);
    const car = await ok("get_vehicle", { vehicle: id });
    expect(car.odometer).toMatchObject({ value: 80_000, date: day(-3) });
  });

  it("works out the consumption of a full fill that closes a stretch", async () => {
    const { call, ok, vehicle, day } = await connect();
    await vehicle();
    await ok("add_fuel_log", {
      vehicle: "Familienauto",
      date: day(-30),
      odometer: 10_000,
      quantity: 50,
      amount: "90.00",
    });
    const second = await call("add_fuel_log", {
      vehicle: "Familienauto",
      date: day(-10),
      odometer: 10_600,
      quantity: 41,
      amount: "73.80",
    });
    expect(second.summary).toContain("Consumption 6.83 l/100 km over 600 km.");
    expect(second.json).toMatchObject({
      distance: 600,
      consumptionPer100: 6.83,
      costPerDistance: "0.123 CHF/km",
    });
  });

  it("adds partial fills to the stretch they belong to, and shows them as partial", async () => {
    const { ok, vehicle, day } = await connect();
    await vehicle();
    const fill = (extra: Record<string, unknown>) =>
      ok("add_fuel_log", { vehicle: "Familienauto", ...extra });
    await fill({
      date: day(-30),
      odometer: 10_000,
      quantity: 50,
      amount: "90",
    });
    const partial = await fill({
      date: day(-20),
      odometer: 10_300,
      quantity: 15,
      amount: "27",
      fullTank: false,
    });
    expect(partial.fullTank).toBe(false);
    expect(partial.consumptionPer100).toBeUndefined();
    const closing = await fill({
      date: day(-10),
      odometer: 10_600,
      quantity: 25,
      amount: "45",
    });
    expect(closing).toMatchObject({ distance: 600, consumptionPer100: 6.67 });

    const list = await ok("list_fuel_logs", { vehicle: "Familienauto" });
    expect(list.fills.map((f: { odometer: number }) => f.odometer)).toEqual([
      10_600, 10_300, 10_000,
    ]);
    expect(list.fills[1].fullTank).toBe(false);
  });

  it("starts the chain again after a fill that was missed", async () => {
    const { ok, vehicle, day } = await connect();
    await vehicle();
    const fill = (extra: Record<string, unknown>) =>
      ok("add_fuel_log", { vehicle: "Familienauto", ...extra });
    await fill({ date: day(-30), odometer: 1_000, quantity: 40, amount: "70" });
    const gap = await fill({
      date: day(-10),
      odometer: 3_000,
      quantity: 60,
      amount: "100",
      missedPrevious: true,
    });
    expect(gap.missedPrevious).toBe(true);
    expect(gap.consumptionPer100).toBeUndefined();
  });

  it("charges an electric vehicle in kWh, and a free charge books no cost entry", async () => {
    const { ok, vehicle } = await connect();
    await vehicle("Stromer", "BE 111111", { fuelType: "electric" });
    const charge = await ok("add_fuel_log", {
      vehicle: "Stromer",
      odometer: 5_000,
      quantity: 22.5,
      amount: "0",
      station: "Muster Ladesäule",
    });
    expect(charge).toMatchObject({ unit: "kWh", amount: "0.00 CHF" });
    expect(charge.costEntryId).toBeUndefined();
    expect(charge.pricePerUnit).toBe("0.000 CHF/kWh");
    expect((await ok("list_costs", { asset: "Stromer" })).costs).toEqual([]);
  });

  it("books the cost to somebody else, unshared, in another currency", async () => {
    const { ok, vehicle } = await connect();
    await vehicle();
    const fill = await ok("add_fuel_log", {
      vehicle: "Familienauto",
      odometer: 1_000,
      quantity: 30,
      amount: "55,5",
      currency: "EUR",
      paidBy: "Ben",
      split: "none",
    });
    expect(fill.amount).toBe("55.50 EUR");
    const [cost] = (await ok("list_costs", { asset: "Familienauto" })).costs;
    expect(cost).toMatchObject({
      amount: "55.50 EUR",
      paidBy: "Ben",
      split: "none",
    });
  });

  it("refuses an odometer lower than the reading before, and writes nothing", async () => {
    const { call, ok, vehicle, day } = await connect();
    await vehicle();
    await ok("record_odometer", {
      vehicle: "Familienauto",
      value: 90_000,
      date: day(-5),
    });
    const reply = await call("add_fuel_log", {
      vehicle: "Familienauto",
      date: day(-1),
      odometer: 9_000,
      quantity: 40,
      amount: "70",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("body.odometer");
    expect(
      (await ok("list_fuel_logs", { vehicle: "Familienauto" })).fills,
    ).toEqual([]);
    expect((await ok("list_costs", { asset: "Familienauto" })).costs).toEqual(
      [],
    );
  });

  it.each([
    ["an amount that is no number", { amount: "cheap" }, "Not a valid amount"],
    ["too many decimals", { amount: "1.234" }, "Too many decimal places"],
    ["a negative amount", { amount: "-5" }, "body.amountMinor"],
    ["a quantity of 0", { quantity: 0 }, "quantity"],
    ["a date in the future", { date: "2999-01-01" }, "body.date"],
  ])("refuses %s", async (_name, over, text) => {
    const { call, vehicle } = await connect();
    await vehicle();
    const reply = await call("add_fuel_log", {
      vehicle: "Familienauto",
      odometer: 1_000,
      quantity: 30,
      amount: "50",
      ...over,
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(text);
  });

  it("does not take a device for a vehicle", async () => {
    const { call, ok } = await connect();
    await ok("create_asset", { name: "Backofen" });
    for (const name of ["add_fuel_log", "list_fuel_logs"]) {
      const reply = await call(name, {
        vehicle: "Backofen",
        odometer: 1,
        quantity: 1,
        amount: "1",
      });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("not a vehicle");
    }
  });

  it("lists newest first, by year, and page by page", async () => {
    const { ok, vehicle } = await connect();
    await vehicle();
    await vehicle("Roller", "BE 222222");
    const fill = (vehicleRef: string, date: string, odometer: number) =>
      ok("add_fuel_log", {
        vehicle: vehicleRef,
        date,
        odometer,
        quantity: 10,
        amount: "20",
      });
    await fill("Familienauto", "2023-12-30", 1_000);
    await fill("Familienauto", "2024-02-01", 1_500);
    await fill("Familienauto", "2024-05-01", 2_000);
    await fill("Roller", "2024-03-01", 100);

    const all = await ok("list_fuel_logs", { vehicle: "Familienauto" });
    expect(all.fills.map((f: { date: string }) => f.date)).toEqual([
      "2024-05-01",
      "2024-02-01",
      "2023-12-30",
    ]);
    const year = await ok("list_fuel_logs", {
      vehicle: "Familienauto",
      year: 2024,
    });
    expect(year.fills).toHaveLength(2);

    const first = await ok("list_fuel_logs", {
      vehicle: "Familienauto",
      limit: 2,
    });
    expect(first.fills).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const rest = await ok("list_fuel_logs", {
      vehicle: "Familienauto",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(rest.fills.map((f: { date: string }) => f.date)).toEqual([
      "2023-12-30",
    ]);
  });

  it("says so when the log is empty", async () => {
    const { call, vehicle } = await connect();
    await vehicle();
    const reply = await call("list_fuel_logs", { vehicle: "Familienauto" });
    expect(reply.summary).toBe(
      "0 fuel log entries of Familienauto, ZH 000000.",
    );
    expect(reply.json.fills).toEqual([]);
  });
});
