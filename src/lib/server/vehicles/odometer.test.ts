import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask, NOW } from "$lib/testing/domain";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import {
  notifications,
  odometerReadings,
  signalSamples,
  signals,
  taskState,
} from "$lib/server/db";
import {
  getSignal,
  listSamples,
  pruneSignals,
} from "$lib/server/signals/service";
import { evaluateAll } from "$lib/server/tasks/evaluator";
import { getTask } from "$lib/server/tasks/tasks";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  deleteOdometerReading,
  listReadings,
  recordOdometer,
  removeReadingsOfSource,
  type OdometerInput,
} from "./odometer";
import { putVehicle } from "./vehicles";

const DAY = 86_400_000;

describe("odometer readings", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const record = (
    assetId: string,
    date: string,
    value: number,
    over: Partial<OdometerInput> = {},
    now = NOW,
  ) =>
    recordOdometer(ctx(now), {
      assetId,
      date,
      value,
      source: "manual",
      ...over,
    });
  const values = (assetId: string) =>
    listReadings(ctx(), assetId, { limit: 100 }).items.map(
      (r) => `${r.date} ${r.value}`,
    );

  describe("recording", () => {
    it("keeps every reading and mirrors the newest as a manual signal with a sample per reading", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      await record(car.id, "2026-06-01", 81_500, { note: "Tankstelle" });
      const last = await record(car.id, "2026-06-10", 82_300);

      expect(last).toMatchObject({
        assetId: car.id,
        date: "2026-06-10",
        value: 82_300,
        source: "manual",
        sourceId: null,
      });
      expect(values(car.id)).toEqual([
        "2026-06-10 82300",
        "2026-06-01 81500",
        "2026-05-01 80000",
      ]);
      expect(listReadings(ctx(), car.id, { limit: 10 }).items[1].note).toBe(
        "Tankstelle",
      );

      const signal = getSignal(ctx(), odometerSignalKey(car.id));
      expect(signal).toMatchObject({
        numeric: 82_300,
        text: "82300",
        unit: "km",
        source: "manual",
      });
      expect(signal?.seenAt.getTime()).toBe(NOW);
      expect(signal?.changedAt.getTime()).toBe(at("2026-06-10"));
      expect(
        listSamples(ctx(), odometerSignalKey(car.id)).map((s) => [
          s.at.getTime(),
          s.value,
        ]),
      ).toEqual([
        [at("2026-06-10"), 82_300],
        [at("2026-06-01"), 81_500],
        [at("2026-05-01"), 80_000],
      ]);
    });

    it("a reading dated today counts from the moment it was entered when that was earlier", async () => {
      const car = makeVehicle(test);
      const morning = at("2026-06-15", "08:30");
      await record(car.id, "2026-06-15", 82_000, {}, morning);
      expect(
        listSamples(ctx(), odometerSignalKey(car.id)).map((s) =>
          s.at.getTime(),
        ),
      ).toEqual([morning]);
    });

    it("a reading from the past is a sample but does not become the current one", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-06-10", 82_300);
      await record(car.id, "2026-05-01", 80_000);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(82_300);
      expect(
        listSamples(ctx(), odometerSignalKey(car.id)).map((s) => s.value),
      ).toEqual([82_300, 80_000]);
    });

    it("of two readings on one day the one entered last is the current one", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-06-10", 82_000, {}, at("2026-06-10", "08:00"));
      await record(car.id, "2026-06-10", 82_040, {}, at("2026-06-10", "17:00"));
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(82_040);
      expect(values(car.id)).toEqual(["2026-06-10 82040", "2026-06-10 82000"]);
    });

    it("keeps vehicles apart", async () => {
      const a = makeVehicle(test, "Auto A");
      const b = makeVehicle(test, "Auto B");
      await record(a.id, "2026-06-10", 82_000);
      await record(b.id, "2026-06-11", 15_000);
      expect(getSignal(ctx(), odometerSignalKey(a.id))?.numeric).toBe(82_000);
      expect(getSignal(ctx(), odometerSignalKey(b.id))?.numeric).toBe(15_000);
      expect(values(a.id)).toEqual(["2026-06-10 82000"]);
    });

    it("writes the unit of the vehicle onto the signal", async () => {
      const car = makeVehicle(test);
      putVehicle(ctx(), car.id, { odometerUnit: "mi" });
      await record(car.id, "2026-06-10", 12_000);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.unit).toBe("mi");
      putVehicle(ctx(), car.id, {});
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.unit).toBe("km");
    });
  });

  describe("what is refused", () => {
    it.each([
      ["lower than the reading before", "2026-06-10", 79_999, "value"],
      ["lower than a reading of the same day", "2026-05-01", 79_999, "value"],
      ["in the future", "2026-06-16", 90_000, "date"],
      ["not a date", "2026-02-30", 90_000, "date"],
      ["negative", "2026-06-10", -1, "value"],
      ["not a number", "2026-06-10", Number.NaN, "value"],
      ["beyond any odometer", "2026-06-10", 10_000_001, "value"],
    ])("%s is a 400 on %s", async (_name, date, value, field) => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      const err = await failure(() => record(car.id, date, value));
      expect(err.code).toBe("invalid_request");
      expect(err.status).toBe(400);
      expect(fieldErrors(err, field)).not.toEqual([]);
      expect(values(car.id)).toEqual(["2026-05-01 80000"]);
    });

    it("names the reading it is lower than", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      const err = await failure(() => record(car.id, "2026-06-01", 79_000));
      expect(fieldErrors(err, "value")[0]).toContain("80000");
      expect(fieldErrors(err, "value")[0]).toContain("2026-05-01");
    });

    it("compares with the reading before the date, not with the newest", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-04-01", 70_000);
      await record(car.id, "2026-06-01", 82_000);
      await record(car.id, "2026-05-01", 76_000);
      expect(values(car.id)).toEqual([
        "2026-06-01 82000",
        "2026-05-01 76000",
        "2026-04-01 70000",
      ]);
      const err = await failure(() => record(car.id, "2026-05-15", 75_000));
      expect(fieldErrors(err, "value")).not.toEqual([]);
    });

    it("refuses a value above the reading after its date, unless forced", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-01-01", 10_000);
      await record(car.id, "2026-06-01", 20_000);
      const err = await failure(() => record(car.id, "2026-03-01", 25_000));
      expect(err.status).toBe(400);
      expect(fieldErrors(err, "value")[0]).toContain("20000");
      expect(fieldErrors(err, "value")[0]).toContain("2026-06-01");
      expect(values(car.id)).toEqual(["2026-06-01 20000", "2026-01-01 10000"]);
      // The signal and the samples stay as they were.
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(20_000);
      expect(
        listSamples(ctx(), odometerSignalKey(car.id)).map((s) => s.value),
      ).toEqual([20_000, 10_000]);
      // Equal is fine, and so is anything in between.
      await record(car.id, "2026-03-01", 20_000);
      await record(car.id, "2026-02-01", 12_000);
      await record(car.id, "2026-04-01", 25_000, { force: true });
      expect(values(car.id)).toContain("2026-04-01 25000");
    });

    it("compares a reading it changes with the one after it as well", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-01-01", 10_000);
      await record(car.id, "2026-03-01", 15_000, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      await record(car.id, "2026-06-01", 20_000);
      const err = await failure(() =>
        record(car.id, "2026-03-01", 25_000, {
          source: "fuel_log",
          sourceId: "fill-1",
        }),
      );
      expect(fieldErrors(err, "value")).not.toEqual([]);
      expect(values(car.id)).toContain("2026-03-01 15000");
      await record(car.id, "2026-03-01", 19_000, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
    });

    it("takes the same value again", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      await record(car.id, "2026-06-01", 80_000);
      expect(values(car.id)).toHaveLength(2);
    });

    it("takes a lower value when forced, and measures from there on", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-04-01", 120_000);
      await record(car.id, "2026-05-01", 500, { force: true });
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(500);
      await record(car.id, "2026-06-01", 1_800);
      expect(values(car.id)).toEqual([
        "2026-06-01 1800",
        "2026-05-01 500",
        "2026-04-01 120000",
      ]);
      const err = await failure(() => record(car.id, "2026-06-10", 400));
      expect(fieldErrors(err, "value")).not.toEqual([]);
    });

    it("only vehicles have an odometer", async () => {
      const device = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Waschmaschine" }),
      );
      const err = await failure(() => record(device.id, "2026-06-01", 10));
      expect(err.code).toBe("invalid_request");
      expect(test.db.select().from(odometerReadings).all()).toEqual([]);
    });

    it("an asset that does not exist is a 404", async () => {
      const err = await failure(() => record("missing", "2026-06-01", 10));
      expect(err.code).toBe("not_found");
    });
  });

  describe("readings with a source record", () => {
    it("saving the same record again changes its reading instead of adding one", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      const first = await record(car.id, "2026-06-01", 81_000, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      const again = await record(car.id, "2026-06-02", 81_200, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      expect(again.id).toBe(first.id);
      expect(values(car.id)).toEqual(["2026-06-02 81200", "2026-05-01 80000"]);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(81_200);
    });

    it("does not compare a reading with itself", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-06-01", 81_000, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      await record(car.id, "2026-06-01", 80_900, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      expect(values(car.id)).toEqual(["2026-06-01 80900"]);
    });

    it("a source record is only used once per source", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-06-01", 81_000, {
        source: "fuel_log",
        sourceId: "x",
      });
      await record(car.id, "2026-06-02", 81_100, {
        source: "tire_change",
        sourceId: "x",
      });
      expect(values(car.id)).toHaveLength(2);
    });

    it("removes the readings of a record", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      await record(car.id, "2026-06-01", 81_000, {
        source: "fuel_log",
        sourceId: "fill-1",
      });
      removeReadingsOfSource(ctx(), "fuel_log", "fill-1");
      expect(values(car.id)).toEqual(["2026-05-01 80000"]);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(80_000);
      removeReadingsOfSource(ctx(), "fuel_log", "nothing");
      expect(values(car.id)).toHaveLength(1);
    });
  });

  describe("deleting", () => {
    it("the newest of the remaining readings becomes the current one", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      const newest = await record(car.id, "2026-06-01", 81_500);
      await deleteOdometerReading(ctx(), newest.id);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(80_000);
      expect(
        listSamples(ctx(), odometerSignalKey(car.id)).map((s) => s.value),
      ).toEqual([80_000]);
    });

    it("the last reading takes the signal and its history with it", async () => {
      const car = makeVehicle(test);
      const only = await record(car.id, "2026-05-01", 80_000);
      await deleteOdometerReading(ctx(), only.id);
      expect(getSignal(ctx(), odometerSignalKey(car.id))).toBeUndefined();
      expect(listSamples(ctx(), odometerSignalKey(car.id))).toEqual([]);
    });

    it("a reading that does not exist is a 404", async () => {
      const err = await failure(() => deleteOdometerReading(ctx(), "nope"));
      expect(err.code).toBe("not_found");
    });

    it("deleting the vehicle takes readings and signal with it", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-05-01", 80_000);
      deleteAsset(ctx(), car.id);
      expect(test.db.select().from(odometerReadings).all()).toEqual([]);
      expect(test.db.select().from(signals).all()).toEqual([]);
      expect(test.db.select().from(signalSamples).all()).toEqual([]);
    });
  });

  describe("pages", () => {
    it("lists newest first and pages on without gaps or repeats", async () => {
      const car = makeVehicle(test);
      for (let i = 1; i <= 5; i += 1) {
        await record(car.id, `2026-05-0${i}`, 80_000 + i * 100);
      }
      const first = listReadings(ctx(), car.id, { limit: 2 });
      expect(first.items.map((r) => r.date)).toEqual([
        "2026-05-05",
        "2026-05-04",
      ]);
      const second = listReadings(ctx(), car.id, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((r) => r.date)).toEqual([
        "2026-05-03",
        "2026-05-02",
      ]);
      const third = listReadings(ctx(), car.id, {
        limit: 2,
        cursor: second.nextCursor!,
      });
      expect(third.items.map((r) => r.date)).toEqual(["2026-05-01"]);
      expect(third.nextCursor).toBeNull();
    });

    it("pages through readings of one day in the order they were entered", async () => {
      const car = makeVehicle(test);
      await record(car.id, "2026-06-01", 81_000, {}, NOW);
      await record(car.id, "2026-06-01", 81_010, {}, NOW);
      await record(car.id, "2026-06-01", 81_020, {}, NOW);
      const seen: number[] = [];
      let cursor: string | undefined;
      do {
        const page = listReadings(ctx(), car.id, { limit: 1, cursor });
        seen.push(...page.items.map((r) => r.value));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual([81_020, 81_010, 81_000]);
    });

    it("a vehicle without readings has an empty list; a missing asset is a 404", async () => {
      const car = makeVehicle(test);
      expect(listReadings(ctx(), car.id, { limit: 10 })).toEqual({
        items: [],
        nextCursor: null,
      });
      const err = await failure(() =>
        listReadings(ctx(), "nope", { limit: 1 }),
      );
      expect(err.code).toBe("not_found");
    });
  });
});

describe("tasks that count on the odometer", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const record = (assetId: string, date: string, value: number, now = NOW) =>
    recordOdometer(ctx(now), { assetId, date, value, source: "manual" });
  const serviceOf = (assetId: string, over = {}) =>
    ({
      v: 1,
      type: "counter_delta",
      entityId: odometerSignalKey(assetId),
      threshold: 15_000,
      unit: "km",
      ...over,
    }) as const;
  const stateOf = (taskId: string) => getTask(ctx(), taskId).state;

  it("becomes due when the odometer has grown by the threshold, and says so", async () => {
    const anna = await createTestUser();
    const car = makeVehicle(test);
    const task = await makeTask(ctx(), {
      title: "Service",
      assetId: car.id,
      trigger: serviceOf(car.id),
    });
    expect(task.state).toMatchObject({ status: "unknown" });

    await record(car.id, "2026-06-15", 80_000);
    expect(stateOf(task.id)).toMatchObject({
      status: "ok",
      progress: { current: 0, target: 15_000, unit: "km" },
    });
    expect(stateOf(task.id)?.counterBaseline).toBe(80_000);

    await record(car.id, "2026-06-15", 90_000);
    expect(stateOf(task.id)?.progress?.current).toBe(10_000);
    expect(test.db.select().from(notifications).all()).toEqual([]);

    await record(car.id, "2026-06-15", 95_100);
    expect(stateOf(task.id)).toMatchObject({
      status: "due",
      dueKind: "condition",
      progress: { current: 15_100, target: 15_000 },
    });
    const sent = test.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "due"))
      .all();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: anna.id, taskId: task.id });
  });

  it("follows a deleted reading", async () => {
    const car = makeVehicle(test);
    const task = await makeTask(ctx(), { trigger: serviceOf(car.id) });
    await record(car.id, "2026-06-01", 80_000);
    const wrong = await record(car.id, "2026-06-15", 960_000);
    expect(stateOf(task.id)?.status).toBe("due");
    await deleteOdometerReading(ctx(), wrong.id);
    expect(stateOf(task.id)).toMatchObject({
      status: "ok",
      progress: { current: 0 },
    });
  });

  it("a manual reading does not go stale however long it stays the newest", async () => {
    const car = makeVehicle(test);
    const task = await makeTask(ctx(), { trigger: serviceOf(car.id) });
    await record(car.id, "2026-06-15", 80_000);
    await record(car.id, "2026-06-15", 88_000);
    const later = NOW + 120 * DAY;
    await evaluateAll(ctx(later));
    expect(stateOf(task.id)).toMatchObject({
      status: "ok",
      progress: { current: 8_000, target: 15_000 },
    });
    expect(stateOf(task.id)?.reasons).toEqual([]);
  });

  it("a service every 15,000 km or 12 months falls due by time when little is driven", async () => {
    const car = makeVehicle(test);
    const task = await makeTask(ctx(), {
      trigger: serviceOf(car.id, { orEvery: { every: 12, unit: "month" } }),
    });
    expect(task.state).toMatchObject({
      status: "ok",
      dueDate: "2027-06-15",
      dueKind: "exact",
      reasons: ["signal_missing"],
    });
    await record(car.id, "2026-06-15", 80_000);
    expect(stateOf(task.id)).toMatchObject({
      status: "ok",
      dueDate: "2027-06-15",
      reasons: [],
    });
    await record(car.id, "2026-06-15", 83_000);

    const yearLater = at("2027-06-16");
    await evaluateAll(ctx(yearLater));
    expect(stateOf(task.id)).toMatchObject({
      status: "overdue",
      dueDate: "2027-06-15",
      dueKind: "exact",
    });
    expect(stateOf(task.id)?.progress?.current).toBe(3_000);
  });

  it("estimates the day the threshold is reached from the readings", async () => {
    const car = makeVehicle(test);
    const task = await makeTask(ctx(at("2026-04-01")), {
      trigger: serviceOf(car.id),
    });
    await record(car.id, "2026-04-20", 80_000, at("2026-04-20"));
    await record(car.id, "2026-05-20", 81_500, at("2026-05-20"));
    await record(car.id, "2026-06-12", 82_650, at("2026-06-12"));
    await evaluateAll(ctx());
    const state = stateOf(task.id);
    expect(state).toMatchObject({
      status: "ok",
      dueDate: null,
      dueKind: "estimated",
      estimate: { date: "2027-02-17", confidence: "medium" },
    });
  });

  it("reaches back far enough to estimate from a few readings spread over months", async () => {
    const car = makeVehicle(test);
    const task = await makeTask(ctx(at("2026-01-01")), {
      trigger: serviceOf(car.id),
    });
    await record(car.id, "2026-01-02", 80_000, at("2026-01-02"));
    await record(car.id, "2026-03-15", 83_650, at("2026-03-15"));
    await evaluateAll(ctx());
    expect(stateOf(task.id)).toMatchObject({
      dueKind: "estimated",
      estimate: { confidence: "medium" },
    });
    expect(stateOf(task.id)?.estimate?.date).toMatch(/^2027-/);
  });

  it("keeps the readings the estimate rests on when old samples are pruned", async () => {
    const car = makeVehicle(test);
    await record(car.id, "2026-01-02", 80_000, at("2026-01-02"));
    await record(car.id, "2026-03-15", 83_650, at("2026-03-15"));
    pruneSignals(ctx(at("2027-12-01")), []);
    expect(
      listSamples(ctx(), odometerSignalKey(car.id)).map((s) => s.value),
    ).toEqual([83_650, 80_000]);
    expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(83_650);
  });

  it("the state cache of tasks is not touched by readings of other vehicles", async () => {
    const a = makeVehicle(test, "Auto A");
    const b = makeVehicle(test, "Auto B");
    const taskA = await makeTask(ctx(), { trigger: serviceOf(a.id) });
    await record(a.id, "2026-06-15", 80_000);
    const before = test.db
      .select()
      .from(taskState)
      .where(eq(taskState.taskId, taskA.id))
      .get();
    await record(b.id, "2026-06-15", 12_000, NOW + 60_000);
    const after = test.db
      .select()
      .from(taskState)
      .where(eq(taskState.taskId, taskA.id))
      .get();
    expect(after?.evaluatedAt).toEqual(before?.evaluatedAt);
  });
});
