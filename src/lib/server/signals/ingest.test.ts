import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createAsset } from "$lib/server/assets/assets";
import { createHint } from "$lib/server/hints/hints";
import {
  notifications,
  pendingReactions,
  taskCompletions,
} from "$lib/server/db";
import { completeTask } from "$lib/server/tasks/completions";
import { evaluateTaskById } from "$lib/server/tasks/evaluator";
import { getTask, updateTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { applyAutoComplete } from "./auto-complete";
import { afterCalendarSync, ingestSignals } from "./ingest";
import { processDueReactions } from "./reactions";
import {
  replaceExternalDates,
  upsertSignals,
  type SignalReading,
} from "./service";

const MIN = 60_000;
const num = (key: string, value: number, changedAt: number): SignalReading => ({
  key,
  numeric: value,
  text: String(value),
  changedAt,
});
const state = (
  key: string,
  value: string,
  changedAt: number,
): SignalReading => ({
  key,
  numeric: null,
  text: value,
  changedAt,
});

describe("ingestSignals", () => {
  const test = useTestDB();
  const ctx = (offsetMin = 0) => ctxAt(test.db, NOW + offsetMin * MIN);
  const completions = (taskId: string) =>
    test.db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId))
      .all();

  describe("counter_delta", () => {
    const WASHER = "sensor.example_washer_cycles";
    const washer = {
      v: 1,
      type: "counter_delta",
      entityId: WASHER,
      threshold: 5,
      unit: "cycles",
    } as const;

    it("takes the first reading as the baseline and becomes due after enough cycles", async () => {
      const anna = await createTestUser();
      const task = await makeTask(ctx(), {
        title: "Descale washer",
        trigger: washer,
      });
      expect(task.state).toMatchObject({ status: "unknown" });

      await ingestSignals(ctx(1), [num(WASHER, 0, NOW)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        progress: { current: 0, target: 5, unit: "cycles" },
      });
      expect(getTask(ctx(), task.id).state?.counterBaseline).toBe(0);

      await ingestSignals(ctx(2), [num(WASHER, 3, NOW)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        progress: { current: 3, target: 5 },
      });
      expect(test.db.select().from(notifications).all()).toEqual([]);

      const summary = await ingestSignals(ctx(3), [num(WASHER, 5, NOW)], "ha");
      expect(summary.changed).toBe(1);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        dueKind: "condition",
        progress: { current: 5, target: 5 },
      });
      const sent = test.db
        .select()
        .from(notifications)
        .where(eq(notifications.kind, "due"))
        .all();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        userId: anna.id,
        kind: "due",
        taskId: task.id,
      });
    });

    it("a completion snapshots the counter, so the next period starts there", async () => {
      const task = await makeTask(ctx(), {
        title: "Descale washer",
        trigger: washer,
      });
      await ingestSignals(ctx(1), [num(WASHER, 0, NOW)], "ha");
      await ingestSignals(ctx(2), [num(WASHER, 6, NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.status).toBe("due");

      const { completion, task: after } = await completeTask(ctx(3), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      expect(completion.counterValue).toBe(6);
      expect(after.state).toMatchObject({
        status: "ok",
        progress: { current: 0, target: 5 },
      });
      await ingestSignals(ctx(4), [num(WASHER, 9, NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.progress).toEqual({
        current: 3,
        target: 5,
        unit: "cycles",
      });
      await ingestSignals(ctx(5), [num(WASHER, 11, NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.status).toBe("due");
    });

    it("an explicit counter value of the caller wins over the snapshot", async () => {
      const task = await makeTask(ctx(), { trigger: washer });
      await ingestSignals(ctx(1), [num(WASHER, 8, NOW)], "ha");
      const { completion } = await completeTask(ctx(2), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        counterValue: 3,
      });
      expect(completion.counterValue).toBe(3);
    });

    it("a cloud counter that jumps at once makes the task due in one step", async () => {
      const task = await makeTask(ctx(), {
        trigger: { ...washer, threshold: 50 },
      });
      await ingestSignals(ctx(1), [num(WASHER, 3, NOW)], "ha");
      await ingestSignals(ctx(2), [num(WASHER, 120, NOW)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        progress: { current: 117, target: 50 },
      });
    });

    it("an unavailable counter keeps its last value instead of hiding the task", async () => {
      const task = await makeTask(ctx(), { trigger: washer });
      await ingestSignals(ctx(1), [num(WASHER, 2, NOW)], "ha");
      const gap = await ingestSignals(
        ctx(2),
        [{ key: WASHER, numeric: null, text: null, changedAt: NOW }],
        "ha",
      );
      expect(gap).toMatchObject({ changed: 0, skipped: 1 });
      expect(getTask(ctx(), task.id).state?.progress?.current).toBe(0);
    });

    it("forgets the baseline when the task is pointed at another counter, but not on other edits", async () => {
      const OTHER = "sensor.example_other_counter";
      const task = await makeTask(ctx(), { trigger: washer });
      await ingestSignals(ctx(1), [num(WASHER, 100, NOW)], "ha");
      await ingestSignals(ctx(1), [num(OTHER, 7, NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.counterBaseline).toBe(100);
      await updateTask(ctx(2), task.id, { title: "Renamed", trigger: washer });
      expect(getTask(ctx(), task.id).state?.counterBaseline).toBe(100);
      await updateTask(ctx(3), task.id, {
        trigger: { ...washer, entityId: OTHER },
      });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        counterBaseline: 7,
        progress: { current: 0, target: 5 },
      });
    });

    it("goes stale when nothing valid arrives for a day", async () => {
      const task = await makeTask(ctx(), { trigger: washer });
      await ingestSignals(ctx(1), [num(WASHER, 2, NOW)], "ha");
      const later = ctxAt(test.db, NOW + 25 * 60 * MIN);
      expect((await evaluateTaskById(later, task.id))?.reasons).toContain(
        "signal_stale",
      );
    });
  });

  describe("auto-complete", () => {
    const FILTER = "sensor.example_filter_hours";
    const filter = {
      v: 1,
      type: "counter_delta",
      entityId: FILTER,
      threshold: 400,
      autoCompleteOnReset: { minDrop: 100 },
    } as const;

    it("completes a counter task by the system when the counter is reset", async () => {
      const task = await makeTask(ctx(), { title: "Filter", trigger: filter });
      await ingestSignals(ctx(1), [num(FILTER, 0, NOW)], "ha");
      await ingestSignals(ctx(2), [num(FILTER, 450, NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.status).toBe("due");

      const summary = await ingestSignals(
        ctx(3),
        [num(FILTER, 2, NOW + 3 * MIN)],
        "ha",
      );
      expect(summary.autoCompleted).toBe(1);
      const [done] = completions(task.id);
      expect(done).toMatchObject({
        source: "ha",
        userId: null,
        kind: "done",
        counterValue: 2,
      });
      expect(done.idempotencyKey).toMatch(/^auto:/);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        progress: { current: 0, target: 400 },
      });
    });

    it("ignores a drop smaller than the minimum and the first sight of a signal", async () => {
      const task = await makeTask(ctx(), { trigger: filter });
      await ingestSignals(ctx(1), [num(FILTER, 10, NOW)], "ha");
      expect(completions(task.id)).toEqual([]);
      await ingestSignals(ctx(2), [num(FILTER, 300, NOW)], "ha");
      await ingestSignals(ctx(3), [num(FILTER, 250, NOW)], "ha");
      expect(completions(task.id)).toEqual([]);
    });

    it("applying the same change twice completes once; the next real reset completes again", async () => {
      const task = await makeTask(ctx(), { trigger: filter });
      const change = {
        key: FILTER,
        prev: { numeric: 450, text: "450", changedAt: NOW },
        next: { numeric: 1, text: "1", changedAt: NOW + MIN },
      };
      upsertSignals(ctx(1), [num(FILTER, 450, NOW)], "ha");
      expect(await applyAutoComplete(ctx(2), [change])).toEqual([task.id]);
      expect(await applyAutoComplete(ctx(2), [change])).toEqual([task.id]);
      expect(completions(task.id)).toHaveLength(1);
      const second = {
        key: FILTER,
        prev: { numeric: 500, text: "500", changedAt: NOW + 5 * MIN },
        next: { numeric: 0, text: "0", changedAt: NOW + 6 * MIN },
      };
      await applyAutoComplete(ctx(7), [second]);
      expect(completions(task.id)).toHaveLength(2);
    });

    it("completes on a state change to the awaited value, from the optional previous one", async () => {
      const PROGRAM = "sensor.example_program";
      const task = await makeTask(ctx(), {
        trigger: {
          ...everyDays(30, "2026-06-20"),
          autoComplete: [
            {
              type: "state_change",
              entityId: PROGRAM,
              to: "Descale",
              from: "idle",
            },
          ],
        },
      });
      await ingestSignals(ctx(1), [state(PROGRAM, "idle", NOW)], "ha");
      await ingestSignals(ctx(2), [state(PROGRAM, "eco", NOW)], "ha");
      await ingestSignals(ctx(3), [state(PROGRAM, "descale", NOW)], "ha");
      // eco -> descale: not from idle
      expect(completions(task.id)).toEqual([]);
      await ingestSignals(ctx(4), [state(PROGRAM, "idle", NOW)], "ha");
      await ingestSignals(ctx(5), [state(PROGRAM, "DESCALE", NOW)], "ha");
      expect(completions(task.id)).toHaveLength(1);
      expect(completions(task.id)[0]).toMatchObject({
        source: "ha",
        userId: null,
      });
      expect(getTask(ctx(), task.id).state?.dueDate).toBe("2026-07-15");
    });

    it("does not touch archived tasks", async () => {
      const task = await makeTask(ctx(), { trigger: filter });
      await updateTask(ctx(), task.id, { archived: true });
      upsertSignals(ctx(1), [num(FILTER, 450, NOW)], "ha");
      await ingestSignals(ctx(2), [num(FILTER, 0, NOW)], "ha");
      expect(completions(task.id)).toEqual([]);
    });
  });

  describe("state_condition", () => {
    const DOOR = "binary_sensor.example_door";
    const door = {
      v: 1,
      type: "state_condition",
      entityId: DOOR,
      op: "eq",
      value: "on",
    } as const;

    it("is due while the condition holds, acknowledged by a completion, due again on the next occurrence", async () => {
      const task = await makeTask(ctx(), { trigger: door });
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");

      await ingestSignals(ctx(2), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      const due = getTask(ctx(), task.id).state;
      expect(due).toMatchObject({ status: "due", dueKind: "condition" });
      expect(due?.activeSince).toBe(NOW + 2 * MIN);
      expect(due?.occurrenceKey).toBe(`s:${NOW + 2 * MIN}`);

      await completeTask(ctx(3), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        reasons: ["acknowledged"],
      });
      // still on: stays acknowledged
      await ingestSignals(ctx(4), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");

      await ingestSignals(ctx(5), [state(DOOR, "off", NOW + 5 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state?.activeSince).toBeNull();
      await ingestSignals(ctx(6), [state(DOOR, "on", NOW + 6 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        activeSince: NOW + 6 * MIN,
      });
    });

    it("keeps the start of a numeric condition while its value keeps changing, and honours forMinutes", async () => {
      const LEVEL = "sensor.example_level";
      const task = await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "state_condition",
          entityId: LEVEL,
          op: "gt",
          value: 80,
          forMinutes: 10,
        },
      });
      await ingestSignals(ctx(1), [num(LEVEL, 70, NOW)], "ha");
      await ingestSignals(ctx(2), [num(LEVEL, 85, NOW + 2 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        reasons: ["condition_pending"],
      });
      await ingestSignals(ctx(8), [num(LEVEL, 90, NOW + 8 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state?.activeSince).toBe(NOW + 2 * MIN);
      await ingestSignals(ctx(13), [num(LEVEL, 95, NOW + 13 * MIN)], "ha");
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        activeSince: NOW + 2 * MIN,
      });
    });
  });

  describe("ha_calendar", () => {
    it("is due the evening before an event once its dates arrive", async () => {
      const KEY = "calendar.example_waste#paper";
      const task = await makeTask(ctx(), {
        title: "Put out paper",
        trigger: {
          v: 1,
          type: "ha_calendar",
          entityId: "calendar.example_waste",
          summaryMatch: "paper",
          offsetDays: -1,
        },
      });
      expect(task.state?.reasons).toEqual(["no_upcoming_events"]);
      replaceExternalDates(ctx(), KEY, [
        { date: "2026-06-16", title: "Paper" },
        { date: "2026-06-30" },
      ]);
      expect(await afterCalendarSync(ctx(), [KEY])).toBe(1);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "due",
        dueDate: "2026-06-15",
        occurrenceKey: "2026-06-16",
      });
      await completeTask(ctx(1), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "ok",
        dueDate: "2026-06-29",
      });
    });
  });

  describe("hint reactions", () => {
    const DOOR = "binary_sensor.example_garage";
    async function setup(reaction: Record<string, unknown> = {}, users = 2) {
      const people = [];
      for (let i = 0; i < users; i++) people.push(await createTestUser());
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Garage door" }),
      );
      const hint = createHint(
        ctx(),
        asset.id,
        createHintRequestSchema.parse({
          title: "Close the door",
          reaction: {
            type: "signal_change",
            entityId: DOOR,
            toState: "on",
            delayMinutes: 10,
            notify: "all",
            ...reaction,
          },
        }),
      );
      return { people, asset, hint };
    }
    const hints = () =>
      test.db
        .select()
        .from(notifications)
        .where(eq(notifications.kind, "hint"))
        .all();
    const pending = () => test.db.select().from(pendingReactions).all();

    it("notifies after the delay, once per transition, everyone by default", async () => {
      const { people, asset } = await setup();
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      const summary = await ingestSignals(
        ctx(2),
        [state(DOOR, "on", NOW + 2 * MIN)],
        "ha",
      );
      expect(summary.reactionsScheduled).toBe(1);
      expect(pending()).toHaveLength(1);
      expect(pending()[0].fireAt.getTime()).toBe(NOW + 12 * MIN);
      expect(hints()).toEqual([]);

      expect(await processDueReactions(ctx(11))).toEqual({
        sent: 0,
        cancelled: 0,
      });
      expect(await processDueReactions(ctx(12))).toEqual({
        sent: 1,
        cancelled: 0,
      });
      expect(
        hints()
          .map((n) => n.userId)
          .sort(),
      ).toEqual(people.map((p) => p.id).sort());
      expect(hints()[0]).toMatchObject({
        titleKey: "notification_hint",
        paramsJson: { asset: "Garage door", title: "Close the door" },
        url: `/assets/${asset.id}`,
        taskId: null,
      });
      expect(pending()[0].status).toBe("sent");
      // nothing more, even when it is processed again or the same state is read again
      expect(await processDueReactions(ctx(30))).toEqual({
        sent: 0,
        cancelled: 0,
      });
      await ingestSignals(ctx(31), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      expect(hints()).toHaveLength(2);
    });

    it("fires at once without a delay, when the change arrives", async () => {
      await setup({ delayMinutes: undefined }, 1);
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      const summary = await ingestSignals(
        ctx(2),
        [state(DOOR, "on", NOW + MIN)],
        "ha",
      );
      expect(summary).toMatchObject({
        reactionsScheduled: 1,
        reactionsFired: 1,
      });
      expect(hints()).toHaveLength(1);
    });

    it("a transition that does not match schedules nothing: other state, other origin, first sight", async () => {
      await setup({ fromState: "off" });
      await ingestSignals(ctx(1), [state(DOOR, "on", NOW)], "ha"); // first sight
      await ingestSignals(ctx(2), [state(DOOR, "unavailable-ish", NOW)], "ha");
      await ingestSignals(ctx(3), [state(DOOR, "on", NOW)], "ha"); // from unavailable-ish, not off
      expect(pending()).toEqual([]);
      await ingestSignals(ctx(4), [state(DOOR, "off", NOW)], "ha");
      await ingestSignals(ctx(5), [state(DOOR, "on", NOW + 5 * MIN)], "ha");
      expect(pending()).toHaveLength(1);
    });

    it("is cancelled when the state leaves before the delay has passed", async () => {
      await setup();
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      await ingestSignals(ctx(2), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      await ingestSignals(ctx(5), [state(DOOR, "off", NOW + 5 * MIN)], "ha");
      expect(pending()[0].status).toBe("cancelled");
      expect(await processDueReactions(ctx(30))).toEqual({
        sent: 0,
        cancelled: 0,
      });
      expect(hints()).toEqual([]);
    });

    it("a later transition schedules its own reaction", async () => {
      await setup({ delayMinutes: 1 }, 1);
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      await ingestSignals(ctx(2), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      await processDueReactions(ctx(4));
      await ingestSignals(ctx(5), [state(DOOR, "off", NOW + 5 * MIN)], "ha");
      await ingestSignals(ctx(6), [state(DOOR, "on", NOW + 6 * MIN)], "ha");
      await processDueReactions(ctx(8));
      expect(hints()).toHaveLength(2);
      expect(pending().map((p) => p.status)).toEqual(["sent", "sent"]);
    });

    it("survives a restart: pending reactions are read from the database", async () => {
      await setup();
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      await ingestSignals(ctx(2), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      // nothing in memory is needed: a new process only has the rows
      expect(pending()).toHaveLength(1);
      expect(await processDueReactions(ctx(13))).toEqual({
        sent: 1,
        cancelled: 0,
      });
    });

    it("is cancelled instead of sent when the signal is no longer in the state, or the hint is gone", async () => {
      await setup();
      await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
      await ingestSignals(ctx(2), [state(DOOR, "on", NOW + 2 * MIN)], "ha");
      // the signal moved on without a recorded change (stored directly)
      upsertSignals(ctx(5), [state(DOOR, "off", NOW + 5 * MIN)], "ha");
      expect(await processDueReactions(ctx(13))).toEqual({
        sent: 0,
        cancelled: 1,
      });
      expect(hints()).toEqual([]);
    });
  });
});

describe("hint reaction recipients", () => {
  const test = useTestDB();
  const ctx = (offsetMin = 0) => ctxAt(test.db, NOW + offsetMin * MIN);
  const DOOR = "binary_sensor.example_garage";

  async function run(notify: unknown, taskAssignee?: "first") {
    const [anna, ben, cleo] = [
      await createTestUser(),
      await createTestUser(),
      await createTestUser(),
    ];
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Door" }),
    );
    let taskId: string | undefined;
    if (taskAssignee) {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-07-20"),
        assignMode: "fixed",
        assigneeUserId: ben.id,
      });
      taskId = task.id;
    }
    createHint(
      ctx(),
      asset.id,
      createHintRequestSchema.parse({
        title: "Close",
        taskId,
        reaction: {
          type: "signal_change",
          entityId: DOOR,
          toState: "on",
          notify: notify === "ids" ? [anna.id, cleo.id] : notify,
        },
      }),
    );
    await ingestSignals(ctx(1), [state(DOOR, "off", NOW)], "ha");
    await ingestSignals(ctx(2), [state(DOOR, "on", NOW + MIN)], "ha");
    const got = test.db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(and(eq(notifications.kind, "hint")))
      .all()
      .map((r) => r.userId);
    return { got, anna, ben, cleo };
  }

  it("a list of people", async () => {
    const { got, anna, cleo } = await run("ids");
    expect(got.sort()).toEqual([anna.id, cleo.id].sort());
  });

  it("the assignee of the linked task", async () => {
    const { got, ben } = await run("assignee", "first");
    expect(got).toEqual([ben.id]);
  });

  it("everyone when the hint has no task to take an assignee from", async () => {
    const { got } = await run("assignee");
    expect(got).toHaveLength(3);
  });
});
