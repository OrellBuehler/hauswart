import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type FuelLog = {
  id: string;
  assetId: string;
  date: string;
  odometer: number;
  quantity: number;
  unit: string;
  amountMinor: number;
  currency: string;
  fullTank: boolean;
  station: string | null;
  costEntryId: string | null;
  paidByUserId: string | null;
  pricePerUnitMinor: number | null;
  distance: number | null;
  consumptionPer100: number | null;
  costPerDistanceMinor: number | null;
};
type Page<T> = { items: T[]; nextCursor: string | null };

function fieldError(body: unknown, field: string): string[] {
  const details = (
    body as { error: { details?: { body?: { fieldErrors?: object } } } }
  ).error.details?.body?.fieldErrors as Record<string, string[]> | undefined;
  return details?.[field] ?? [];
}

describe("fuel log API", () => {
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
    const fill = async (json: object) =>
      call("POST", `/api/v1/assets/${car.id}/fuel-logs`, { json });
    return { user, call, car, fill };
  }

  it("logs a fill-up: the log, the reading and the cost entry", async () => {
    const { user, call, car, fill } = await setup();
    const r = await fill({
      date: today(-3),
      odometer: 80_000,
      quantity: 41.2,
      amountMinor: 7_416,
      station: "Muster Tankstelle",
    });
    expect(r.res.status).toBe(201);
    const log = r.body as FuelLog;
    expect(log).toMatchObject({
      assetId: car.id,
      date: today(-3),
      odometer: 80_000,
      quantity: 41.2,
      unit: "l",
      amountMinor: 7_416,
      currency: "CHF",
      fullTank: true,
      station: "Muster Tankstelle",
      paidByUserId: user.id,
      pricePerUnitMinor: 180,
    });
    expect((await call("GET", `/api/v1/fuel-logs/${log.id}`)).body).toEqual(
      log,
    );

    const cost = (await call("GET", `/api/v1/costs/${log.costEntryId}`))
      .body as {
      category: string;
      title: string;
      assetId: string;
      amountMinor: number;
    };
    expect(cost).toMatchObject({
      category: "fuel",
      title: "Tanken Muster Tankstelle",
      assetId: car.id,
      amountMinor: 7_416,
    });
    const readings = (await call("GET", `/api/v1/assets/${car.id}/odometer`))
      .body as Page<{ value: number; source: string; sourceId: string }>;
    expect(readings.items).toMatchObject([
      { value: 80_000, source: "fuel_log", sourceId: log.id },
    ]);
    const vehicle = (await call("GET", `/api/v1/assets/${car.id}/vehicle`))
      .body as {
      odometer: { value: number };
    };
    expect(vehicle.odometer.value).toBe(80_000);
  });

  it("lists newest first with the consumption of each full stretch", async () => {
    const { call, car, fill } = await setup();
    await fill({
      date: today(-30),
      odometer: 10_000,
      quantity: 50,
      amountMinor: 9_000,
    });
    await fill({
      date: today(-20),
      odometer: 10_300,
      quantity: 15,
      amountMinor: 2_700,
      fullTank: false,
    });
    await fill({
      date: today(-10),
      odometer: 10_700,
      quantity: 35,
      amountMinor: 6_300,
    });
    const list = (await call("GET", `/api/v1/assets/${car.id}/fuel-logs`))
      .body as Page<FuelLog>;
    expect(list.items.map((l) => l.odometer)).toEqual([10_700, 10_300, 10_000]);
    expect(list.items[0].distance).toBe(700);
    expect(list.items[0].consumptionPer100).toBeCloseTo((50 / 700) * 100, 9);
    expect(list.items[0].costPerDistanceMinor).toBeCloseTo(9_000 / 700, 9);
    expect(list.items[1].consumptionPer100).toBeNull();

    const paged = (
      await call("GET", `/api/v1/assets/${car.id}/fuel-logs?limit=2`)
    ).body as Page<FuelLog>;
    expect(paged.items).toHaveLength(2);
    expect(paged.nextCursor).not.toBeNull();
    const year = today().slice(0, 4);
    const filtered = (
      await call(
        "GET",
        `/api/v1/assets/${car.id}/fuel-logs?year=${Number(year) - 5}`,
      )
    ).body as Page<FuelLog>;
    expect(filtered.items).toEqual([]);
  });

  it("changes an entry and its cost entry follows", async () => {
    const { call, fill } = await setup();
    const log = (
      await fill({ odometer: 80_000, quantity: 40, amountMinor: 7_200 })
    ).body as FuelLog;
    const patched = await call("PATCH", `/api/v1/fuel-logs/${log.id}`, {
      json: { amountMinor: 7_600, station: "Neu" },
    });
    expect(patched.res.status).toBe(200);
    expect(patched.body).toMatchObject({ amountMinor: 7_600, station: "Neu" });
    expect(
      (await call("GET", `/api/v1/costs/${log.costEntryId}`)).body,
    ).toMatchObject({ amountMinor: 7_600, title: "Tanken Neu" });
    expect(
      errorCode(
        await call("PATCH", `/api/v1/fuel-logs/${log.id}`, { json: {} }),
      ),
    ).toBe("invalid_request");
  });

  it("deletes an entry with its reading and its cost entry", async () => {
    const { call, car, fill } = await setup();
    const log = (
      await fill({ odometer: 80_000, quantity: 40, amountMinor: 7_200 })
    ).body as FuelLog;
    expect(
      (await call("DELETE", `/api/v1/fuel-logs/${log.id}`)).res.status,
    ).toBe(204);
    expect(errorCode(await call("GET", `/api/v1/fuel-logs/${log.id}`))).toBe(
      "not_found",
    );
    expect(
      errorCode(await call("GET", `/api/v1/costs/${log.costEntryId}`)),
    ).toBe("not_found");
    expect(
      (
        (await call("GET", `/api/v1/assets/${car.id}/odometer`))
          .body as Page<unknown>
      ).items,
    ).toEqual([]);
    expect(errorCode(await call("DELETE", `/api/v1/fuel-logs/${log.id}`))).toBe(
      "not_found",
    );
  });

  it.each([
    ["no quantity", { odometer: 1, amountMinor: 1 }, "quantity"],
    [
      "a quantity of zero",
      { odometer: 1, quantity: 0, amountMinor: 1 },
      "quantity",
    ],
    [
      "a negative amount",
      { odometer: 1, quantity: 1, amountMinor: -5 },
      "amountMinor",
    ],
    [
      "an amount with decimals",
      { odometer: 1, quantity: 1, amountMinor: 1.5 },
      "amountMinor",
    ],
    ["no odometer", { quantity: 1, amountMinor: 1 }, "odometer"],
    [
      "a unit that does not exist",
      { odometer: 1, quantity: 1, amountMinor: 1, unit: "gal" },
      "unit",
    ],
    [
      "a date in the future",
      { odometer: 1, quantity: 1, amountMinor: 1, date: "2999-01-01" },
      "date",
    ],
    [
      "a payer who does not exist",
      { odometer: 1, quantity: 1, amountMinor: 1, paidByUserId: "nope" },
      "paidByUserId",
    ],
    [
      "a currency that is none",
      { odometer: 1, quantity: 1, amountMinor: 1, currency: "chf" },
      "currency",
    ],
  ])("refuses %s", async (_name, json, field) => {
    const { fill } = await setup();
    const r = await fill(json);
    expect(r.res.status).toBe(400);
    expect(fieldError(r.body, field)).not.toEqual([]);
  });

  it("refuses an odometer lower than the reading before, on odometer", async () => {
    const { call, car, fill } = await setup();
    await call("POST", `/api/v1/assets/${car.id}/odometer`, {
      json: { value: 90_000, date: today(-5) },
    });
    const r = await fill({
      odometer: 80_000,
      quantity: 40,
      amountMinor: 7_200,
    });
    expect(r.res.status).toBe(400);
    expect(fieldError(r.body, "odometer")).not.toEqual([]);
    expect(
      (
        (await call("GET", `/api/v1/assets/${car.id}/fuel-logs`))
          .body as Page<unknown>
      ).items,
    ).toEqual([]);
  });

  it("only vehicles have a fuel log", async () => {
    const { call } = await setup();
    const device = (
      await call("POST", "/api/v1/assets", { json: { name: "Backofen" } })
    ).body as { id: string };
    const r = await call("POST", `/api/v1/assets/${device.id}/fuel-logs`, {
      json: { odometer: 1, quantity: 1, amountMinor: 1 },
    });
    expect(r.res.status).toBe(400);
    expect(errorCode(await call("GET", "/api/v1/assets/nope/fuel-logs"))).toBe(
      "not_found",
    );
  });

  it("books money, so changes need costs:write; reading needs read", async () => {
    const { user, car, fill } = await setup();
    const log = (
      await fill({ odometer: 80_000, quantity: 40, amountMinor: 7_200 })
    ).body as FuelLog;
    const writer = createCaller({
      bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
    });
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    const books = createCaller({
      bearer: createTestToken(user, { scopes: ["costs:write"] }).token,
    });
    for (const who of [writer, reader]) {
      expect((await who("GET", `/api/v1/fuel-logs/${log.id}`)).res.status).toBe(
        200,
      );
      expect(
        (
          await who("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
            json: { odometer: 80_100, quantity: 1, amountMinor: 1 },
          })
        ).res.status,
      ).toBe(403);
      expect(
        (
          await who("PATCH", `/api/v1/fuel-logs/${log.id}`, {
            json: { notes: "x" },
          })
        ).res.status,
      ).toBe(403);
      expect(
        (await who("DELETE", `/api/v1/fuel-logs/${log.id}`)).res.status,
      ).toBe(403);
    }
    expect(
      (
        await books("PATCH", `/api/v1/fuel-logs/${log.id}`, {
          json: { notes: "x" },
        })
      ).res.status,
    ).toBe(200);
    expect((await books("GET", `/api/v1/fuel-logs/${log.id}`)).res.status).toBe(
      403,
    );
  });
});
