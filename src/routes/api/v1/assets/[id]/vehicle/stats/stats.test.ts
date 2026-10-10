import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type Stats = {
  assetId: string;
  year: number | null;
  from: string | null;
  to: string | null;
  odometerUnit: string;
  distance: number;
  distanceByMonth: { month: string; distance: number }[];
  costs: {
    currency: string;
    totalMinor: number;
    count: number;
    byCategory: { category: string; totalMinor: number }[];
  };
  costPerDistanceMinor: number | null;
  consumption: {
    unit: string;
    averagePer100: number | null;
    stretchCount: number;
    last: { consumptionPer100: number }[];
  }[];
  priceTrend: { pricePerUnitMinor: number }[];
  tireSet: { id: string; season: string; mounted: boolean } | null;
  nextTasks: { title: string; status: string }[];
};

describe("vehicle statistics API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const car = (
      await call("POST", "/api/v1/assets", {
        json: { name: "Familienauto", kind: "vehicle" },
      })
    ).body as { id: string };
    return { user, call, car };
  }

  it("is empty for a new vehicle, for a year and for all time", async () => {
    const { call, car } = await setup();
    const all = await call("GET", `/api/v1/assets/${car.id}/vehicle/stats`);
    expect(all.res.status).toBe(200);
    expect(all.body).toMatchObject({
      assetId: car.id,
      year: null,
      from: null,
      distance: 0,
      distanceByMonth: [],
      costPerDistanceMinor: null,
      consumption: [],
      priceTrend: [],
      tireSet: null,
      nextTasks: [],
    });
    const year = Number(today().slice(0, 4));
    const one = (
      await call("GET", `/api/v1/assets/${car.id}/vehicle/stats?year=${year}`)
    ).body as Stats;
    expect(one).toMatchObject({
      year,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    });
    expect(one.distanceByMonth).toHaveLength(12);
  });

  it("puts fill-ups, readings, costs, tires and tasks together", async () => {
    const { call, car } = await setup();
    const post = (path: string, json: object) => call("POST", path, { json });
    await post(`/api/v1/assets/${car.id}/fuel-logs`, {
      date: today(-60),
      odometer: 10_000,
      quantity: 50,
      amountMinor: 9_000,
    });
    await post(`/api/v1/assets/${car.id}/fuel-logs`, {
      date: today(-30),
      odometer: 10_700,
      quantity: 49,
      amountMinor: 9_310,
    });
    await post(`/api/v1/assets/${car.id}/odometer`, {
      date: today(-1),
      value: 11_000,
    });
    const set = (
      await post(`/api/v1/assets/${car.id}/tire-sets`, { season: "summer" })
    ).body as { id: string };
    await post(`/api/v1/assets/${car.id}/tire-sets/${set.id}/mount`, {});
    await post("/api/v1/tasks", {
      title: "MFK",
      assetId: car.id,
      trigger: { v: 1, type: "one_off", date: today(20) },
    });

    const s = (await call("GET", `/api/v1/assets/${car.id}/vehicle/stats`))
      .body as Stats;
    expect(s.distance).toBe(1_000);
    expect(s.costs).toMatchObject({
      currency: "CHF",
      totalMinor: 18_310,
      count: 2,
    });
    expect(s.costs.byCategory).toEqual([
      expect.objectContaining({ category: "fuel", totalMinor: 18_310 }),
    ]);
    expect(s.costPerDistanceMinor).toBeCloseTo(18.31, 9);
    expect(s.consumption).toHaveLength(1);
    expect(s.consumption[0].averagePer100).toBeCloseTo((49 / 700) * 100, 9);
    expect(s.priceTrend.map((p) => p.pricePerUnitMinor)).toEqual([180, 190]);
    expect(s.tireSet).toMatchObject({
      id: set.id,
      season: "summer",
      mounted: true,
    });
    expect(s.nextTasks).toMatchObject([{ title: "MFK" }]);
  });

  it("the cost summary can be limited to the vehicle", async () => {
    const { call, car } = await setup();
    const year = today().slice(0, 4);
    await call("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
      json: { odometer: 10_000, quantity: 50, amountMinor: 9_000 },
    });
    await call("POST", "/api/v1/costs", {
      json: { title: "Sonstiges", amountMinor: 50_000, category: "repair" },
    });
    const all = (await call("GET", `/api/v1/costs/summary?year=${year}`))
      .body as {
      expenseTotalMinor: number;
    };
    const only = (
      await call("GET", `/api/v1/costs/summary?year=${year}&assetId=${car.id}`)
    ).body as { expenseTotalMinor: number; byCategory: { category: string }[] };
    expect(all.expenseTotalMinor).toBe(59_000);
    expect(only.expenseTotalMinor).toBe(9_000);
    expect(only.byCategory.map((c) => c.category)).toEqual(["fuel"]);
  });

  it("refuses a year that is none, and a vehicle that is none", async () => {
    const { call, car } = await setup();
    expect(
      (await call("GET", `/api/v1/assets/${car.id}/vehicle/stats?year=abc`)).res
        .status,
    ).toBe(400);
    expect(
      (await call("GET", `/api/v1/assets/${car.id}/vehicle/stats?year=1800`))
        .res.status,
    ).toBe(400);
    const device = (
      await call("POST", "/api/v1/assets", { json: { name: "Backofen" } })
    ).body as { id: string };
    expect(
      errorCode(await call("GET", `/api/v1/assets/${device.id}/vehicle/stats`)),
    ).toBe("not_found");
    expect(
      errorCode(await call("GET", "/api/v1/assets/nope/vehicle/stats")),
    ).toBe("not_found");
  });

  it("needs read", async () => {
    const { user, car } = await setup();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    const none = createCaller({
      bearer: createTestToken(user, { scopes: ["write"] }).token,
    });
    expect(
      (await reader("GET", `/api/v1/assets/${car.id}/vehicle/stats`)).res
        .status,
    ).toBe(200);
    expect(
      (await none("GET", `/api/v1/assets/${car.id}/vehicle/stats`)).res.status,
    ).toBe(403);
  });
});
