import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  createServiceLogRequestSchema,
  updateServiceLogRequestSchema,
} from "$lib/api/schemas/service-log";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { odometerReadings, serviceLog } from "$lib/server/db";
import { getSignal } from "$lib/server/signals/service";
import {
  createEntry,
  deleteEntry,
  updateEntry,
} from "$lib/server/service-log/service-log";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { listReadings, recordOdometer } from "./odometer";

describe("service log entries with an odometer value", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const entry = (over: Record<string, unknown> = {}) =>
    createServiceLogRequestSchema.parse({ title: "Ölwechsel", ...over });
  const patch = (over: Record<string, unknown>) =>
    updateServiceLogRequestSchema.parse(over);
  const readings = (assetId: string) =>
    listReadings(ctx(), assetId, { limit: 100 }).items;
  const signalValue = (assetId: string) =>
    getSignal(ctx(), odometerSignalKey(assetId))?.numeric;

  it("writes a reading of the vehicle on the date of the entry", () => {
    const car = makeVehicle(test);
    const created = createEntry(
      ctx(),
      car.id,
      entry({ date: "2026-06-10", odometer: 84_200.5 }),
      null,
    );
    expect(created.odometer).toBe(84_200.5);
    expect(readings(car.id)).toMatchObject([
      {
        date: "2026-06-10",
        value: 84_200.5,
        source: "service_log",
        sourceId: created.id,
      },
    ]);
    expect(signalValue(car.id)).toBe(84_200.5);
  });

  it("an entry without a value writes no reading", () => {
    const car = makeVehicle(test);
    const created = createEntry(ctx(), car.id, entry(), null);
    expect(created.odometer).toBeNull();
    expect(readings(car.id)).toEqual([]);
  });

  it("an entry dated today without a date takes today", () => {
    const car = makeVehicle(test);
    createEntry(ctx(), car.id, entry({ odometer: 84_000 }), null);
    expect(readings(car.id)[0].date).toBe("2026-06-15");
  });

  it("a value lower than the reading before is a 400 on odometer and saves nothing", async () => {
    const car = makeVehicle(test);
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-01",
      value: 90_000,
      source: "manual",
    });
    const err = await failure(() =>
      createEntry(ctx(), car.id, entry({ odometer: 80_000 }), null),
    );
    expect(err.code).toBe("invalid_request");
    expect(fieldErrors(err, "odometer")).not.toEqual([]);
    expect(test.db.select().from(serviceLog).all()).toEqual([]);
    expect(readings(car.id)).toHaveLength(1);
  });

  it("a date in the future is a 400 on date", async () => {
    const car = makeVehicle(test);
    const err = await failure(() =>
      createEntry(
        ctx(),
        car.id,
        entry({ date: "2026-12-01", odometer: 84_000 }),
        null,
      ),
    );
    expect(fieldErrors(err, "date")).not.toEqual([]);
    expect(test.db.select().from(serviceLog).all()).toEqual([]);
  });

  it("only a vehicle can take an odometer value", async () => {
    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    const err = await failure(() =>
      createEntry(ctx(), device.id, entry({ odometer: 10 }), null),
    );
    expect(fieldErrors(err, "odometer")).not.toEqual([]);
    expect(test.db.select().from(serviceLog).all()).toEqual([]);
    // Entries without a value work for any asset.
    expect(createEntry(ctx(), device.id, entry(), null).odometer).toBeNull();
  });

  describe("changing the entry", () => {
    it("changes the reading with the value and moves it with the date", () => {
      const car = makeVehicle(test);
      const created = createEntry(
        ctx(),
        car.id,
        entry({ date: "2026-06-10", odometer: 84_000 }),
        null,
      );
      updateEntry(ctx(), car.id, created.id, patch({ odometer: 84_100 }));
      expect(readings(car.id)).toMatchObject([
        { date: "2026-06-10", value: 84_100, sourceId: created.id },
      ]);
      updateEntry(ctx(), car.id, created.id, patch({ date: "2026-06-12" }));
      expect(readings(car.id)).toMatchObject([
        { date: "2026-06-12", value: 84_100 },
      ]);
      expect(readings(car.id)).toHaveLength(1);
      expect(signalValue(car.id)).toBe(84_100);
    });

    it("clearing the value takes the reading away", () => {
      const car = makeVehicle(test);
      const created = createEntry(
        ctx(),
        car.id,
        entry({ odometer: 84_000 }),
        null,
      );
      const cleared = updateEntry(
        ctx(),
        car.id,
        created.id,
        patch({ odometer: null }),
      );
      expect(cleared.odometer).toBeNull();
      expect(readings(car.id)).toEqual([]);
      expect(signalValue(car.id)).toBeUndefined();
    });

    it("adding a value later writes the reading", () => {
      const car = makeVehicle(test);
      const created = createEntry(ctx(), car.id, entry(), null);
      updateEntry(ctx(), car.id, created.id, patch({ odometer: 84_000 }));
      expect(readings(car.id)).toMatchObject([
        { value: 84_000, source: "service_log", sourceId: created.id },
      ]);
    });

    it("other changes leave the reading alone", () => {
      const car = makeVehicle(test);
      const created = createEntry(
        ctx(),
        car.id,
        entry({ odometer: 84_000 }),
        null,
      );
      const before = readings(car.id)[0];
      updateEntry(
        ctx(),
        car.id,
        created.id,
        patch({ title: "Grosser Service" }),
      );
      expect(readings(car.id)).toEqual([before]);
    });

    it("a value lower than the reading before is refused and the entry stays as it was", async () => {
      const car = makeVehicle(test);
      await recordOdometer(ctx(), {
        assetId: car.id,
        date: "2026-06-01",
        value: 90_000,
        source: "manual",
      });
      const created = createEntry(
        ctx(),
        car.id,
        entry({ date: "2026-06-10", odometer: 91_000 }),
        null,
      );
      const err = await failure(() =>
        updateEntry(ctx(), car.id, created.id, patch({ odometer: 80_000 })),
      );
      expect(fieldErrors(err, "odometer")).not.toEqual([]);
      expect(test.db.select().from(serviceLog).all()[0].odometer).toBe(91_000);
      expect(readings(car.id).map((r) => r.value)).toEqual([91_000, 90_000]);
    });
  });

  it("deleting the entry deletes its reading", () => {
    const car = makeVehicle(test);
    const created = createEntry(
      ctx(),
      car.id,
      entry({ odometer: 84_000 }),
      null,
    );
    deleteEntry(ctx(), car.id, created.id);
    expect(test.db.select().from(odometerReadings).all()).toEqual([]);
    expect(signalValue(car.id)).toBeUndefined();
  });

  it("deleting the vehicle takes its entries and readings along", () => {
    const car = makeVehicle(test);
    createEntry(ctx(), car.id, entry({ odometer: 84_000 }), null);
    deleteAsset(ctx(), car.id);
    expect(test.db.select().from(serviceLog).all()).toEqual([]);
    expect(test.db.select().from(odometerReadings).all()).toEqual([]);
  });
});
