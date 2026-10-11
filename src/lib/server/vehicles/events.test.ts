import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { odometerReadings, taskCompletions } from "$lib/server/db";
import { getSignal } from "$lib/server/signals/service";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { listReadings, recordOdometer } from "./odometer";

describe("a completion with an odometer reading", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const readings = (assetId: string) =>
    listReadings(ctx(), assetId, { limit: 100 }).items;
  const trigger = (assetId: string) =>
    ({
      v: 1,
      type: "counter_delta",
      entityId: odometerSignalKey(assetId),
      threshold: 15_000,
      unit: "km",
    }) as const;
  const finish = (
    taskId: string,
    over: Partial<Parameters<typeof completeTask>[2]> = {},
    now = NOW,
  ) =>
    completeTask(ctx(now), taskId, {
      kind: "done",
      source: "manual",
      userId: null,
      ...over,
    });
  async function setup() {
    const car = makeVehicle(test);
    await recordOdometer(ctx(at("2026-06-01")), {
      assetId: car.id,
      date: "2026-06-01",
      value: 80_000,
      source: "manual",
    });
    const task = await makeTask(ctx(at("2026-06-01")), {
      title: "Service",
      assetId: car.id,
      trigger: trigger(car.id),
    });
    return { car, task };
  }

  it("is also a reading of the vehicle, dated the day of the completion", async () => {
    const anna = await createTestUser();
    const { car, task } = await setup();
    const { completion, task: after } = await finish(task.id, {
      userId: anna.id,
      counterValue: 95_500,
    });
    const [reading] = readings(car.id);
    expect(reading).toMatchObject({
      assetId: car.id,
      date: "2026-06-15",
      value: 95_500,
      source: "completion",
      sourceId: completion.id,
      createdBy: anna.id,
    });
    expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(95_500);
    // The service starts counting from where it was done.
    expect(after.state).toMatchObject({
      status: "ok",
      progress: { current: 0, target: 15_000 },
    });
  });

  it("is undone with the completion", async () => {
    const anna = await createTestUser();
    const { car, task } = await setup();
    const { completion } = await finish(task.id, {
      userId: anna.id,
      counterValue: 95_500,
    });
    await undoCompletion(ctx(), completion.id, anna.id);
    expect(readings(car.id).map((r) => r.value)).toEqual([80_000]);
    expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(80_000);
    expect(getTask(ctx(), task.id).state).toMatchObject({
      progress: { current: 0 },
    });
  });

  it("undoing twice is harmless", async () => {
    const anna = await createTestUser();
    const { car, task } = await setup();
    const { completion } = await finish(task.id, { counterValue: 95_500 });
    await undoCompletion(ctx(), completion.id, anna.id);
    await undoCompletion(ctx(), completion.id, anna.id);
    expect(readings(car.id)).toHaveLength(1);
  });

  it("a reading taken from the counter itself adds nothing", async () => {
    const { car, task } = await setup();
    const { completion } = await finish(task.id);
    expect(completion.counterValue).toBe(80_000);
    expect(readings(car.id)).toHaveLength(1);
  });

  it("a reading equal to the newest one adds nothing", async () => {
    const { car, task } = await setup();
    await finish(task.id, { counterValue: 80_000 });
    expect(readings(car.id)).toHaveLength(1);
  });

  it("a skipped task with a reading records it as well", async () => {
    const { car, task } = await setup();
    await finish(task.id, { kind: "skipped", counterValue: 81_000 });
    expect(readings(car.id).map((r) => [r.value, r.source])).toEqual([
      [81_000, "completion"],
      [80_000, "manual"],
    ]);
  });

  it("a backdated completion dates the reading back", async () => {
    const { car, task } = await setup();
    await finish(task.id, {
      counterValue: 84_000,
      completedAt: at("2026-06-10"),
    });
    expect(readings(car.id)[0]).toMatchObject({
      date: "2026-06-10",
      value: 84_000,
    });
  });

  describe("backdated, without a reading of its own", () => {
    async function history() {
      const { car, task } = await setup();
      const reading = (date: string, value: number) =>
        recordOdometer(ctx(), {
          assetId: car.id,
          date,
          value,
          source: "manual",
        });
      await reading("2026-06-05", 81_000);
      await reading("2026-06-10", 83_000);
      return { car, task, reading };
    }

    it.each([
      ["before every reading", "2026-05-20", null],
      ["on the day of the first reading", "2026-06-01", 80_000],
      ["between two readings", "2026-06-03", 80_000],
      ["on the day of a later reading", "2026-06-05", 81_000],
      ["after that reading, before the next", "2026-06-08", 81_000],
      ["on the day of the newest reading", "2026-06-10", 83_000],
      ["today", "2026-06-15", 83_000],
    ])(
      "a completion %s (%s) takes the reading on or before its date",
      async (_when, date, expected) => {
        const { car, task } = await history();
        const { completion } = await finish(task.id, {
          completedAt: at(date, "09:00"),
        });
        expect(completion.counterValue).toBe(expected);
        // The snapshot is no new reading.
        expect(readings(car.id).map((r) => r.value)).toEqual([
          83_000, 81_000, 80_000,
        ]);
      },
    );

    it("takes the reading entered last when a day has several", async () => {
      const { task, reading } = await history();
      await reading("2026-06-05", 81_200);
      const { completion } = await finish(task.id, {
        completedAt: at("2026-06-05", "09:00"),
      });
      expect(completion.counterValue).toBe(81_200);
    });

    it("so the next period counts from what the odometer showed then, not from today's value", async () => {
      const { task } = await history();
      const { task: after } = await finish(task.id, {
        completedAt: at("2026-06-05", "09:00"),
      });
      expect(after.state).toMatchObject({
        status: "ok",
        progress: { current: 2_000, target: 15_000 },
      });
    });

    it("a value given with it is taken as it is and dated back; one the day's reading already has adds nothing", async () => {
      const { car, task } = await history();
      await finish(task.id, {
        completedAt: at("2026-06-05", "09:00"),
        counterValue: 81_000,
      });
      expect(readings(car.id)).toHaveLength(3);
      await finish(task.id, {
        completedAt: at("2026-06-06", "09:00"),
        counterValue: 81_500,
      });
      expect(readings(car.id).map((r) => [r.date, r.value, r.source])).toEqual([
        ["2026-06-10", 83_000, "manual"],
        ["2026-06-06", 81_500, "completion"],
        ["2026-06-05", 81_000, "manual"],
        ["2026-06-01", 80_000, "manual"],
      ]);
    });

    it("undoing it removes no reading", async () => {
      const anna = await createTestUser();
      const { car, task } = await history();
      const { completion } = await finish(task.id, {
        userId: anna.id,
        completedAt: at("2026-06-05", "09:00"),
      });
      await undoCompletion(ctx(), completion.id, anna.id);
      expect(readings(car.id).map((r) => r.value)).toEqual([
        83_000, 81_000, 80_000,
      ]);
    });
  });

  it("a completion a few minutes ahead of midnight is dated today, not tomorrow", async () => {
    const { car, task } = await setup();
    // The completion tolerates a clock five minutes ahead, which can be the next day.
    const justBeforeMidnight = at("2026-06-15", "23:58");
    const { completion } = await finish(
      task.id,
      { counterValue: 84_000, completedAt: at("2026-06-16", "00:01") },
      justBeforeMidnight,
    );
    expect(completion.completedDate).toBe("2026-06-16");
    expect(readings(car.id)[0]).toMatchObject({
      date: "2026-06-15",
      value: 84_000,
      source: "completion",
    });
  });

  it("a reading lower than the one before stops the completion, reported on counterValue", async () => {
    const { car, task } = await setup();
    const err = await failure(() => finish(task.id, { counterValue: 70_000 }));
    expect(err.code).toBe("invalid_request");
    expect(fieldErrors(err, "counterValue")).not.toEqual([]);
    expect(readings(car.id)).toHaveLength(1);
    expect(
      test.db
        .select()
        .from(taskCompletions)
        .where(eq(taskCompletions.taskId, task.id))
        .all(),
    ).toEqual([]);
  });

  it("a backdated reading above a later one stops the completion, on counterValue", async () => {
    const { car, task } = await setup();
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-12",
      value: 84_000,
      source: "manual",
    });
    const err = await failure(() =>
      finish(task.id, { counterValue: 90_000, completedAt: at("2026-06-05") }),
    );
    expect(err.code).toBe("invalid_request");
    expect(fieldErrors(err, "counterValue")).not.toEqual([]);
    expect(readings(car.id).map((r) => r.value)).toEqual([84_000, 80_000]);
    const ok = await finish(task.id, {
      counterValue: 82_000,
      completedAt: at("2026-06-05"),
    });
    expect(ok.completion.counterValue).toBe(82_000);
  });

  it("a retried request does not record a second reading", async () => {
    const { car, task } = await setup();
    const key = "retry-key-12345";
    await finish(task.id, { counterValue: 90_000, idempotencyKey: key });
    const again = await finish(task.id, {
      counterValue: 90_000,
      idempotencyKey: key,
    });
    expect(again.replayed).toBe(true);
    expect(readings(car.id)).toHaveLength(2);
  });

  it("leaves tasks that do not count the odometer alone", async () => {
    const { car } = await setup();
    const interval = await makeTask(ctx(), {
      assetId: car.id,
      trigger: everyDays(30, "2026-06-20"),
    });
    await finish(interval.id, { counterValue: 90_000 });
    const other = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_counter",
        threshold: 5,
      },
    });
    await finish(other.id, { counterValue: 90_000 });
    expect(readings(car.id)).toHaveLength(1);
  });

  it("completes a task of a vehicle that is gone, or of something that is no vehicle", async () => {
    const gone = makeVehicle(test, "Altes Auto");
    const goneTask = await makeTask(ctx(), { trigger: trigger(gone.id) });
    deleteAsset(ctx(), gone.id);
    await finish(goneTask.id, { counterValue: 1_000 });

    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    const deviceTask = await makeTask(ctx(), { trigger: trigger(device.id) });
    await finish(deviceTask.id, { counterValue: 1_000 });

    expect(test.db.select().from(odometerReadings).all()).toEqual([]);
  });
});
