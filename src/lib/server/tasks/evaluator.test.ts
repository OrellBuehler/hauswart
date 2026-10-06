import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { taskState, tasks } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  at,
  ctxAt,
  everyDays,
  makeTask,
  NOW,
  weekly,
} from "$lib/testing/domain";
import { completeTask, snoozeTask, undoCompletion } from "./completions";
import { evaluateAll, evaluateTaskById } from "./evaluator";
import { setSignalProvider, type SignalProvider } from "./signals";
import { getTask, updateTask } from "./tasks";

describe("evaluator", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  afterEach(() => {
    setSignalProvider(null);
    vi.restoreAllMocks();
  });

  const done = (id: string, userId: string | null = null, now = NOW) =>
    completeTask(ctx(now), id, { kind: "done", source: "manual", userId });

  describe("completion", () => {
    it("re-evaluates synchronously and moves the due date", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(90, "2026-06-10"),
      });
      expect(task.state).toMatchObject({
        status: "overdue",
        dueDate: "2026-06-10",
      });
      const { task: after } = await done(task.id);
      expect(after.state).toMatchObject({
        status: "ok",
        dueDate: "2026-09-13",
        occurrenceKey: "2026-09-13",
      });
      expect(after.state?.reasons).toEqual([]);
    });

    it("a skipped occurrence moves on as well", async () => {
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
      });
      expect(task.state?.dueDate).toBe("2026-06-15");
      await completeTask(ctx(), task.id, {
        kind: "skipped",
        source: "manual",
        userId: null,
      });
      expect((await evaluateTaskById(ctx(), task.id))?.dueDate).toBe(
        "2026-06-22",
      );
    });

    it("undo restores the previous due date", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(90, "2026-06-10"),
      });
      const { completion } = await done(task.id);
      expect(getTask(ctx(), task.id).state?.dueDate).toBe("2026-09-13");
      const member = await createTestUser();
      await undoCompletion(ctx(), completion.id, member.id);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        status: "overdue",
        dueDate: "2026-06-10",
      });
    });

    it("completing a one-off task settles it", async () => {
      const task = await makeTask(ctx(), {
        trigger: { v: 1, type: "one_off", date: "2026-06-16" },
      });
      expect(task.state?.status).toBe("open");
      const { task: after } = await done(task.id);
      expect(after.state).toMatchObject({ status: "ok", dueDate: null });
    });

    it("attributes a completion to the occurrence the task shows", async () => {
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-01", [1]),
      });
      expect(task.state).toMatchObject({
        dueDate: "2026-06-01",
        status: "overdue",
      });
      const { task: second } = await done(task.id);
      expect(second.state?.dueDate).toBe("2026-06-08");
      const { task: third } = await done(task.id);
      expect(third.state?.dueDate).toBe("2026-06-15");
      const { task: fourth } = await done(task.id);
      expect(fourth.state).toMatchObject({
        dueDate: "2026-06-22",
        status: "open",
      });
    });

    it("edits re-evaluate too", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(90, "2026-06-10"),
      });
      await done(task.id);
      const edited = await updateTask(ctx(), task.id, {
        trigger: everyDays(7, "2026-06-01"),
      });
      expect(edited.state?.dueDate).toBe("2026-06-22");
    });
  });

  describe("rotation", () => {
    it("alternates between two people as they complete", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "rotate",
        rotationOrder: [anna.id, ben.id],
      });
      const seen = [task.state?.currentAssigneeUserId];
      for (const who of [anna.id, ben.id, anna.id]) {
        const { task: after } = await done(task.id, who);
        seen.push(after.state?.currentAssigneeUserId);
      }
      expect(seen).toEqual([anna.id, ben.id, anna.id, ben.id]);
    });

    it("when the other person steps in, the rotation continues after them", async () => {
      const [anna, ben, cleo] = [
        await createTestUser(),
        await createTestUser(),
        await createTestUser(),
      ];
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "rotate",
        rotationOrder: [anna.id, ben.id, cleo.id],
      });
      const { task: after } = await done(task.id, ben.id);
      expect(after.state?.currentAssigneeUserId).toBe(cleo.id);
    });

    it("skips do not count as turns", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "rotate",
        rotationOrder: [anna.id, ben.id],
      });
      await completeTask(ctx(), task.id, {
        kind: "skipped",
        source: "manual",
        userId: anna.id,
      });
      expect(getTask(ctx(), task.id).state?.currentAssigneeUserId).toBe(
        anna.id,
      );
    });

    it("undo hands the turn back", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "rotate",
        rotationOrder: [anna.id, ben.id],
      });
      const { completion } = await done(task.id, anna.id);
      expect(getTask(ctx(), task.id).state?.currentAssigneeUserId).toBe(ben.id);
      await undoCompletion(ctx(), completion.id, ben.id);
      expect(getTask(ctx(), task.id).state?.currentAssigneeUserId).toBe(
        anna.id,
      );
    });

    it("the fair strategy gives the turn to whoever did less work in the last 90 days", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const heavy = await makeTask(ctx(), {
        title: "Grosse Arbeit",
        effortMinutes: 120,
        trigger: everyDays(1, "2026-06-01"),
      });
      await done(heavy.id, anna.id);
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "rotate",
        rotationStrategy: "fair",
        rotationOrder: [anna.id, ben.id],
      });
      expect(task.state?.currentAssigneeUserId).toBe(ben.id);
      // Work older than 90 days no longer counts.
      const later = at("2026-10-01");
      await evaluateAll(ctx(later));
      expect(getTask(ctx(), task.id).state?.currentAssigneeUserId).toBe(
        anna.id,
      );
    });

    it("fixed assignment follows no rotation", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx(), {
        trigger: weekly("2026-06-15", [1]),
        assignMode: "fixed",
        assigneeUserId: anna.id,
      });
      const { task: after } = await done(task.id, ben.id);
      expect(after.state?.currentAssigneeUserId).toBe(anna.id);
    });
  });

  describe("snooze", () => {
    it("hides an open task until the date and brings it back", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-16"),
      });
      expect(task.state?.status).toBe("open");
      const snoozed = await snoozeTask(ctx(), task.id, "2026-06-20");
      expect(snoozed).toMatchObject({ snoozedUntil: "2026-06-20" });
      expect(snoozed.state?.status).toBe("snoozed");
      expect(snoozed.state?.reasons).toContain("snoozed");

      await evaluateAll(ctx(at("2026-06-19")));
      expect(getTask(ctx(), task.id).state?.status).toBe("snoozed");
      await evaluateAll(ctx(at("2026-06-20")));
      expect(getTask(ctx(), task.id).state?.status).toBe("overdue");
    });

    it("can be ended early with null", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-16"),
      });
      await snoozeTask(ctx(), task.id, "2026-06-30");
      const woken = await snoozeTask(ctx(), task.id, null);
      expect(woken.snoozedUntil).toBeNull();
      expect(woken.state?.status).toBe("open");
    });

    it("needs a date after today", async () => {
      const task = await makeTask(ctx());
      for (const until of ["2026-06-15", "2026-06-01"]) {
        await expect(snoozeTask(ctx(), task.id, until)).rejects.toMatchObject({
          code: "invalid_request",
        });
      }
      await expect(
        snoozeTask(ctx(), "nope", "2026-07-01"),
      ).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("leaves tasks that are fine alone", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-09-01"),
      });
      const snoozed = await snoozeTask(ctx(), task.id, "2026-06-20");
      expect(snoozed.state?.status).toBe("ok");
    });
  });

  describe("evaluateAll", () => {
    it("refreshes states as days pass", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-25"),
      });
      expect(task.state?.status).toBe("ok");
      const summary = await evaluateAll(ctx(at("2026-06-20")));
      expect(summary).toEqual({ evaluated: 1, failed: 0 });
      expect(getTask(ctx(), task.id).state).toMatchObject({ status: "open" });
      await evaluateAll(ctx(at("2026-06-25")));
      expect(getTask(ctx(), task.id).state?.status).toBe("due");
      await evaluateAll(ctx(at("2026-06-26")));
      expect(getTask(ctx(), task.id).state?.status).toBe("overdue");
    });

    it("rebuilds a lost state", async () => {
      const task = await makeTask(ctx());
      test.db.delete(taskState).where(eq(taskState.taskId, task.id)).run();
      expect(getTask(ctx(), task.id).state).toBeNull();
      await evaluateAll(ctx());
      expect(getTask(ctx(), task.id).state?.dueDate).toBe("2026-06-20");
    });

    it("skips archived tasks", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-25"),
      });
      await updateTask(ctx(), task.id, { archived: true });
      await evaluateAll(ctx(at("2026-06-26")));
      expect(getTask(ctx(), task.id).state?.status).toBe("ok");
    });

    it("one broken task is logged by id and does not stop the rest", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = await makeTask(ctx(), { title: "Kaputt" });
      const fine = await makeTask(ctx(), {
        title: "Heil",
        trigger: everyDays(30, "2026-06-25"),
      });
      test.db
        .update(tasks)
        .set({ trigger: { nonsense: true } })
        .where(eq(tasks.id, broken.id))
        .run();
      const summary = await evaluateAll(ctx(at("2026-06-26")));
      expect(summary).toEqual({ evaluated: 1, failed: 1 });
      expect(
        test.db
          .select()
          .from(taskState)
          .where(eq(taskState.taskId, fine.id))
          .get()?.status,
      ).toBe("overdue");
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain(broken.id);
      expect(logged).not.toContain("Kaputt");
    });

    it("evaluateTaskById is null for unknown tasks and throws for broken ones", async () => {
      expect(await evaluateTaskById(ctx(), "nope")).toBeNull();
      const task = await makeTask(ctx());
      test.db
        .update(tasks)
        .set({ trigger: { nonsense: true } })
        .where(eq(tasks.id, task.id))
        .run();
      await expect(evaluateTaskById(ctx(), task.id)).rejects.toThrow(
        "Stored task trigger is invalid",
      );
    });
  });

  describe("signals", () => {
    const counter = {
      v: 1,
      type: "counter_delta",
      entityId: "sensor.waschmaschine_zyklen",
      threshold: 50,
      unit: "Zyklen",
    } as const;
    const provider = (numeric: number, changedAt = NOW): SignalProvider => ({
      load: (needs) => {
        expect(needs.entityIds).toContain(counter.entityId);
        return {
          signals: { [counter.entityId]: { numeric, changedAt, seenAt: NOW } },
        };
      },
    });

    it("without a provider signal-based tasks are unknown", async () => {
      const task = await makeTask(ctx(), { trigger: counter });
      expect(task.state).toMatchObject({ status: "unknown", dueDate: null });
      expect(task.state?.reasons).toEqual(["signal_missing"]);
    });

    it("asks the provider for exactly the entities the triggers use", async () => {
      const load = vi.fn(() => ({}));
      setSignalProvider({ load });
      await makeTask(ctx(), { trigger: counter });
      await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "state_condition",
          entityId: "binary_sensor.fenster",
          op: "eq",
          value: "on",
          estimateFrom: {
            entityId: "sensor.fuellstand",
            target: 10,
            direction: "down",
          },
        },
      });
      await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "ha_calendar",
          entityId: "calendar.abfall",
          summaryMatch: "Papier",
          offsetDays: -1,
        },
      });
      await makeTask(ctx(), { trigger: everyDays(30, "2026-06-25") });
      const needs = await evaluateAll(ctx()).then(
        () => load.mock.calls.at(-1) as unknown[],
      );
      expect(needs[0]).toEqual({
        entityIds: [
          "binary_sensor.fenster",
          "sensor.fuellstand",
          "sensor.waschmaschine_zyklen",
        ],
        calendars: [
          {
            key: "calendar.abfall#Papier",
            entityId: "calendar.abfall",
            summaryMatch: "Papier",
          },
        ],
      });
    });

    it("a counter that crossed its threshold is due, from the baseline of the last completion", async () => {
      setSignalProvider(provider(160));
      const task = await makeTask(ctx(), { trigger: counter });
      expect(task.state?.reasons).toEqual(["baseline_missing"]);
      const { task: after } = await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        counterValue: 100,
      });
      expect(after.state).toMatchObject({
        status: "due",
        dueKind: "condition",
        progress: { current: 60, target: 50, unit: "Zyklen" },
      });
      const { task: reset } = await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        counterValue: 160,
      });
      expect(reset.state).toMatchObject({
        status: "ok",
        progress: { current: 0, target: 50 },
      });
    });

    it("remembers when a counter first became due", async () => {
      setSignalProvider(provider(160));
      const task = await makeTask(ctx(), { trigger: counter });
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        counterValue: 100,
      });
      const first = test.db
        .select()
        .from(taskState)
        .where(eq(taskState.taskId, task.id))
        .get();
      expect(first?.dueSince).toBe(NOW);
      const later = at("2026-06-18");
      setSignalProvider({
        load: () => ({
          signals: {
            [counter.entityId]: {
              numeric: 170,
              changedAt: later,
              seenAt: later,
            },
          },
        }),
      });
      await evaluateAll(ctx(later));
      const second = test.db
        .select()
        .from(taskState)
        .where(eq(taskState.taskId, task.id))
        .get();
      expect(second?.dueSince).toBe(NOW);
      expect(second?.dueDate).toBe("2026-06-15");
      expect(second?.status).toBe("overdue");
    });

    it("a failing provider is logged and treated as no signals", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      setSignalProvider({
        load: () => {
          throw new TypeError("secret detail");
        },
      });
      const task = await makeTask(ctx(), { trigger: counter });
      expect(task.state?.status).toBe("unknown");
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("signals.load_failed");
      expect(logged).not.toContain("secret detail");
    });

    it("async providers work", async () => {
      setSignalProvider({
        load: async () => ({
          signals: {
            [counter.entityId]: { numeric: 120, changedAt: NOW, seenAt: NOW },
          },
        }),
      });
      const task = await makeTask(ctx(), { trigger: counter });
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        counterValue: 100,
      });
      expect(getTask(ctx(), task.id).state?.progress).toEqual({
        current: 20,
        target: 50,
        unit: "Zyklen",
      });
    });
  });
});
