import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createFuelLogRequestSchema } from "$lib/api/schemas/fuel-logs";
import { createServiceLogRequestSchema } from "$lib/api/schemas/service-log";
import {
  createTireSetRequestSchema,
  mountTireSetRequestSchema,
} from "$lib/api/schemas/tire-sets";
import { deleteAsset } from "$lib/server/assets/assets";
import { odometerReadings } from "$lib/server/db";
import { createEntry, deleteEntry } from "$lib/server/service-log/service-log";
import { completeTask } from "$lib/server/tasks/completions";
import { deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure, makeVehicle } from "$lib/testing/vehicles";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { createFuelLog, deleteFuelLog } from "./fuel-logs";
import {
  deleteOdometerReading,
  listReadings,
  recordOdometer,
} from "./odometer";
import { createTireSet, mountTireSet } from "./tires";

describe("deleting a reading that a record owns", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const readings = (assetId: string) =>
    listReadings(ctx(), assetId, { limit: 100 }).items;

  async function world() {
    const anna = await createTestUser();
    const car = makeVehicle(test);
    await recordOdometer(ctx(at("2026-06-01")), {
      assetId: car.id,
      date: "2026-06-01",
      value: 80_000,
      source: "manual",
    });
    return { anna, car };
  }

  const owners = {
    completion: {
      says: /task completion/,
      async make(car: { id: string }, userId: string) {
        const task = await makeTask(ctx(at("2026-06-01")), {
          title: "Service",
          assetId: car.id,
          trigger: {
            v: 1,
            type: "counter_delta",
            entityId: odometerSignalKey(car.id),
            threshold: 15_000,
            unit: "km",
          },
        });
        await completeTask(ctx(), task.id, {
          kind: "done",
          source: "manual",
          userId,
          counterValue: 82_000,
        });
        return task.id;
      },
    },
    service_log: {
      says: /service log entry/,
      async make(car: { id: string }, userId: string) {
        return createEntry(
          ctx(),
          car.id,
          createServiceLogRequestSchema.parse({
            title: "Ölwechsel",
            date: "2026-06-10",
            odometer: 82_000,
          }),
          userId,
        ).id;
      },
    },
    fuel_log: {
      says: /fuel log entry/,
      async make(car: { id: string }, userId: string) {
        return createFuelLog(
          ctx(),
          car.id,
          createFuelLogRequestSchema.parse({
            date: "2026-06-10",
            odometer: 82_000,
            quantity: 40,
            amountMinor: 7_200,
          }),
          userId,
        ).id;
      },
    },
    tire_change: {
      says: /tire change/,
      async make(car: { id: string }, userId: string) {
        const set = createTireSet(
          ctx(),
          car.id,
          createTireSetRequestSchema.parse({ season: "winter" }),
        );
        mountTireSet(
          ctx(),
          car.id,
          set.id,
          mountTireSetRequestSchema.parse({
            date: "2026-06-10",
            odometer: 82_000,
          }),
          userId,
        );
        return set.id;
      },
    },
  } as const;

  it.each(Object.entries(owners))(
    "a reading of a %s is a 409 that says what owns it, and stays",
    async (source, owner) => {
      const { anna, car } = await world();
      await owner.make(car, anna.id);
      const owned = readings(car.id).find((r) => r.source === source);
      expect(owned).toBeDefined();
      const err = await failure(() => deleteOdometerReading(ctx(), owned!.id));
      expect(err.code).toBe("conflict");
      expect(err.status).toBe(409);
      expect(err.message).toMatch(owner.says);
      expect(err.details).toEqual({ source, sourceId: owned!.sourceId });
      expect(readings(car.id).map((r) => r.id)).toContain(owned!.id);
    },
  );

  it("a free manual reading still deletes", async () => {
    const { car } = await world();
    const manual = await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-05",
      value: 81_000,
      source: "manual",
    });
    await deleteOdometerReading(ctx(), manual.id);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
  });

  it("a reading of a source without a record behind it deletes", async () => {
    const { car } = await world();
    const loose = await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-05",
      value: 81_000,
      source: "signal",
    });
    await deleteOdometerReading(ctx(), loose.id);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
  });

  it("a reading whose record is gone is free again", async () => {
    const { anna, car } = await world();
    const taskId = await owners.completion.make(car, anna.id);
    const owned = readings(car.id).find((r) => r.source === "completion")!;
    deleteTask(ctx(), taskId);
    expect(
      test.db
        .select()
        .from(odometerReadings)
        .where(eq(odometerReadings.id, owned.id))
        .get(),
    ).toBeDefined();
    await deleteOdometerReading(ctx(), owned.id);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
  });

  it("deleting the owner removes its reading as before", async () => {
    const { anna, car } = await world();
    const entryId = await owners.service_log.make(car, anna.id);
    deleteEntry(ctx(), car.id, entryId);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
    const logId = await owners.fuel_log.make(car, anna.id);
    deleteFuelLog(ctx(), logId);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
  });

  it("deleting the vehicle still removes owned readings", async () => {
    const { anna, car } = await world();
    await owners.fuel_log.make(car, anna.id);
    deleteAsset(ctx(), car.id);
    expect(test.db.select().from(odometerReadings).all()).toEqual([]);
  });
});
