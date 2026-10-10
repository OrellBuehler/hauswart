import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { notifications, taskState, type DB } from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { completeTask, snoozeTask } from "$lib/server/tasks/completions";
import { runEvaluationCycle } from "$lib/server/tasks/scheduler";
import {
  completePreparation,
  createPreparation,
} from "$lib/server/tasks/preparations";
import { updateTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import {
  registerNotificationChannel,
  type NotificationChannel,
} from "./channels";
import { generateNotifications, OVERDUE_REMINDERS } from "./generate";

describe("generateNotifications", () => {
  const test = useTestDB();
  const ctx = (when: string, time = "12:00") => ctxAt(test.db, at(when, time));
  afterEach(() => vi.restoreAllMocks());

  const rows = (db: DB, where?: { kind?: string; userId?: string }) =>
    db
      .select()
      .from(notifications)
      .all()
      .filter(
        (r) =>
          (!where?.kind || r.kind === where.kind) &&
          (!where?.userId || r.userId === where.userId),
      );

  async function household() {
    return [
      await createTestUser({ displayName: "Anna" }),
      await createTestUser({ displayName: "Ben" }),
    ] as const;
  }

  it("does nothing without users or tasks", async () => {
    expect(await generateNotifications(ctx("2026-06-15"))).toEqual({
      created: 0,
    });
    await household();
    expect(await generateNotifications(ctx("2026-06-15"))).toEqual({
      created: 0,
    });
  });

  describe("stages", () => {
    it("announces a task coming up to everyone, once", async () => {
      const [anna, ben] = await household();
      const task = await makeTask(ctx("2026-06-15"), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-20"),
      });
      expect(await generateNotifications(ctx("2026-06-15", "07:00"))).toEqual({
        created: 2,
      });
      const soon = rows(test.db, { kind: "due_soon" });
      expect(soon.map((r) => r.userId).sort()).toEqual(
        [anna.id, ben.id].sort(),
      );
      expect(soon[0]).toMatchObject({
        taskId: task.id,
        titleKey: "notification_due_soon",
        paramsJson: { title: "Filter wechseln", date: "2026-06-20" },
        url: `/tasks/${task.id}`,
        readAt: null,
      });
      expect(soon[0].createdAt.getTime()).toBe(at("2026-06-15", "07:00"));
      expect(await generateNotifications(ctx("2026-06-15", "07:30"))).toEqual({
        created: 0,
      });
      expect(await generateNotifications(ctx("2026-06-16", "07:30"))).toEqual({
        created: 0,
      });
      expect(rows(test.db)).toHaveLength(2);
    });

    it("keys by task, occurrence, stage and person", async () => {
      const [anna] = await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      const [row] = rows(test.db, { userId: anna.id });
      expect(row.dedupeKey).toBe(`${task.id}:2026-06-20:due_soon:${anna.id}`);
    });

    it("stays quiet for tasks that are not close", async () => {
      await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-07-20"),
      });
      expect(await generateNotifications(ctx("2026-06-15", "07:00"))).toEqual({
        created: 0,
      });
    });

    it("moves from due soon to due on the day, then overdue", async () => {
      await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      const kinds = async (when: string) => {
        await runEvaluationCycle(ctx(when, "07:00"));
        return [...new Set(rows(test.db).map((r) => r.kind))].sort();
      };
      expect(await kinds("2026-06-18")).toEqual(["due_soon"]);
      expect(await kinds("2026-06-20")).toEqual(["due", "due_soon"]);
      expect(await kinds("2026-06-21")).toEqual(["due", "due_soon", "overdue"]);
    });

    it("honours the task's own lead window", async () => {
      await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-30"),
        dueSoonDays: 20,
      });
      expect(
        (await generateNotifications(ctx("2026-06-15", "07:00"))).created,
      ).toBe(2);
    });

    it("progress-based tasks only speak up once due, not while merely open", async () => {
      await household();
      await makeTask(ctx("2026-06-02"), {
        trigger: { v: 1, type: "min_per_period", period: "month", count: 2 },
      });
      await generateNotifications(ctx("2026-06-02", "07:00"));
      expect(rows(test.db, { kind: "due_soon" })).toHaveLength(0);
      await runEvaluationCycle(ctx("2026-06-20", "07:00"));
      expect(rows(test.db, { kind: "due" })).toHaveLength(2);
    });

    it("a completed occurrence is announced afresh next time", async () => {
      await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(7, "2026-06-16"),
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      await completeTask(ctx("2026-06-16"), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      await runEvaluationCycle(ctx("2026-06-22", "07:00"));
      expect(
        rows(test.db, { kind: "due_soon" })
          .map((r) => r.dedupeKey.split(":")[1])
          .sort(),
      ).toEqual(["2026-06-16", "2026-06-16", "2026-06-23", "2026-06-23"]);
    });
  });

  describe("counter tasks with a time limit", () => {
    const service = {
      v: 1,
      type: "counter_delta",
      entityId: "odometer:example-car",
      threshold: 15_000,
      unit: "km",
      orEvery: { every: 1, unit: "month" },
    } as const;

    it("announce the time limit coming up, due and overdue like any dated task", async () => {
      const [anna] = await household();
      const task = await makeTask(ctx("2026-06-15"), {
        title: "Service",
        trigger: service,
      });
      expect(task.state).toMatchObject({
        status: "ok",
        dueDate: "2026-07-15",
        dueKind: "exact",
      });
      const kindsAt = async (when: string) => {
        await runEvaluationCycle(ctx(when, "07:00"));
        return rows(test.db, { userId: anna.id })
          .filter((r) => r.kind !== "digest")
          .map((r) => r.kind)
          .sort();
      };
      expect(await kindsAt("2026-07-01")).toEqual([]);
      expect(await kindsAt("2026-07-10")).toEqual(["due_soon"]);
      expect(await kindsAt("2026-07-15")).toEqual(["due", "due_soon"]);
      expect(await kindsAt("2026-07-16")).toEqual([
        "due",
        "due_soon",
        "overdue",
      ]);
    });

    describe("when the counter is expected to get there first", () => {
      async function expectedFirst() {
        const [anna] = await household();
        const task = await makeTask(ctx("2026-06-15"), {
          title: "Service",
          trigger: service,
        });
        // What the evaluator stores when the counter is expected to cross before a limit a few
        // days away: the limit stays the due date, the estimate is the earlier guess.
        test.db
          .update(taskState)
          .set({
            status: "open",
            dueDate: "2026-06-20",
            dueKind: "estimated",
            progressJson: { current: 14_000, target: 15_000 },
            estimateJson: { date: "2026-06-17", confidence: "medium" },
          })
          .where(eq(taskState.taskId, task.id))
          .run();
        return { anna, task };
      }

      it("still announces the hard limit coming up", async () => {
        const { anna } = await expectedFirst();
        await generateNotifications(ctx("2026-06-15", "07:00"));
        const soon = rows(test.db, { userId: anna.id, kind: "due_soon" });
        expect(soon).toHaveLength(1);
        expect(soon[0].paramsJson).toMatchObject({
          title: "Service",
          date: "2026-06-20",
        });
      });

      it("prepares for the estimate, which is the date shown", async () => {
        const { anna, task } = await expectedFirst();
        await createPreparation(ctx("2026-06-15"), task.id, {
          title: "Termin buchen",
          kind: "generic",
          leadDays: 3,
          qty: 1,
        });
        test.db
          .update(taskState)
          .set({ status: "ok" })
          .where(eq(taskState.taskId, task.id))
          .run();
        await generateNotifications(ctx("2026-06-14", "07:00"));
        expect(rows(test.db, { userId: anna.id, kind: "prep" })).toHaveLength(
          1,
        );
        expect(
          rows(test.db, { userId: anna.id, kind: "prep" })[0].paramsJson,
        ).toMatchObject({ prep: "Termin buchen", date: "2026-06-17" });
      });
    });

    it("a counter task without a time limit stays quiet until it is due", async () => {
      const [anna] = await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: {
          v: 1,
          type: "counter_delta",
          entityId: service.entityId,
          threshold: service.threshold,
        },
      });
      await runEvaluationCycle(ctx("2026-07-10", "07:00"));
      expect(rows(test.db, { userId: anna.id, kind: "due_soon" })).toEqual([]);
    });
  });

  describe("overdue reminders", () => {
    it("repeat weekly and stop after four", async () => {
      const [anna] = await household();
      await makeTask(ctx("2026-06-01"), {
        trigger: everyDays(30, "2026-06-01"),
      });
      const counts: Record<string, number> = {};
      for (let day = 0; day < 60; day += 1) {
        const when = new Date(Date.UTC(2026, 5, 1 + day))
          .toISOString()
          .slice(0, 10);
        await runEvaluationCycle(ctx(when, "07:00"));
        counts[when] = rows(test.db, {
          kind: "overdue",
          userId: anna.id,
        }).length;
      }
      expect(OVERDUE_REMINDERS).toBe(4);
      expect(counts["2026-06-01"]).toBe(0);
      expect(counts["2026-06-02"]).toBe(1);
      expect(counts["2026-06-08"]).toBe(1);
      expect(counts["2026-06-09"]).toBe(2);
      expect(counts["2026-06-16"]).toBe(3);
      expect(counts["2026-06-23"]).toBe(4);
      expect(counts["2026-07-30"]).toBe(4);
      const last = rows(test.db, { kind: "overdue", userId: anna.id })
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .at(-1);
      expect(last?.paramsJson).toMatchObject({ date: "2026-06-01", days: 22 });
    });

    it("count from the end of the grace period", async () => {
      await household();
      await makeTask(ctx("2026-06-01"), {
        trigger: everyDays(30, "2026-06-01"),
        graceDays: 3,
      });
      await runEvaluationCycle(ctx("2026-06-04", "07:00"));
      expect(rows(test.db, { kind: "overdue" })).toHaveLength(0);
      await runEvaluationCycle(ctx("2026-06-05", "07:00"));
      expect(rows(test.db, { kind: "overdue" })).toHaveLength(2);
    });
  });

  describe("recipients", () => {
    it("tells only the assignee when the task is assigned and notifies the assignee", async () => {
      const [anna, ben] = await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
        assignMode: "fixed",
        assigneeUserId: ben.id,
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(rows(test.db).map((r) => r.userId)).toEqual([ben.id]);
      expect(rows(test.db, { userId: anna.id })).toHaveLength(0);
    });

    it("tells everyone when the task asks for it", async () => {
      await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
        assignMode: "fixed",
        assigneeUserId: (await createTestUser()).id,
        notifyMode: "all",
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(rows(test.db)).toHaveLength(3);
    });

    it("follows the rotation", async () => {
      const [anna, ben] = await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(7, "2026-06-20", "schedule"),
        assignMode: "rotate",
        rotationOrder: [anna.id, ben.id],
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(rows(test.db).map((r) => r.userId)).toEqual([anna.id]);
      await completeTask(ctx("2026-06-16"), task.id, {
        kind: "done",
        source: "manual",
        userId: anna.id,
      });
      await runEvaluationCycle(ctx("2026-06-22", "07:00"));
      expect(rows(test.db, { userId: ben.id }).length).toBeGreaterThan(0);
    });

    it("a reassigned task notifies the new assignee even for the same occurrence", async () => {
      const [anna, ben] = await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
        assignMode: "fixed",
        assigneeUserId: anna.id,
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      await updateTask(ctx("2026-06-15"), task.id, { assigneeUserId: ben.id });
      await generateNotifications(ctx("2026-06-15", "07:30"));
      expect(
        rows(test.db, { kind: "due_soon" })
          .map((r) => r.userId)
          .sort(),
      ).toEqual([anna.id, ben.id].sort());
    });
  });

  describe("preparations", () => {
    it("announces a preparation once it becomes relevant", async () => {
      const [anna] = await household();
      const task = await makeTask(ctx("2026-06-01"), {
        title: "Filter wechseln",
        trigger: everyDays(30, "2026-06-30"),
        dueSoonDays: 1,
      });
      const prep = await createPreparation(ctx("2026-06-01"), task.id, {
        title: "Filter bestellen",
        kind: "generic",
        leadDays: 10,
        qty: 1,
      });
      await runEvaluationCycle(ctx("2026-06-19", "07:00"));
      expect(rows(test.db, { kind: "prep" })).toHaveLength(0);
      await runEvaluationCycle(ctx("2026-06-20", "07:00"));
      const [row] = rows(test.db, { kind: "prep", userId: anna.id });
      expect(row).toMatchObject({
        titleKey: "notification_prep",
        paramsJson: {
          title: "Filter wechseln",
          prep: "Filter bestellen",
          date: "2026-06-30",
        },
        dedupeKey: `${task.id}:2026-06-30:prep-${prep.id}:${anna.id}`,
      });
      expect(rows(test.db, { kind: "prep" })).toHaveLength(2);
      await runEvaluationCycle(ctx("2026-06-21", "07:00"));
      expect(rows(test.db, { kind: "prep" })).toHaveLength(2);
    });

    it("stays quiet about a preparation that is already done", async () => {
      await household();
      const task = await makeTask(ctx("2026-06-01"), {
        trigger: everyDays(30, "2026-06-30"),
        dueSoonDays: 0,
      });
      const prep = await createPreparation(ctx("2026-06-01"), task.id, {
        title: "x",
        kind: "generic",
        leadDays: 10,
        qty: 1,
      });
      await completePreparation(ctx("2026-06-01"), task.id, prep.id, {
        userId: null,
      });
      await runEvaluationCycle(ctx("2026-06-22", "07:00"));
      expect(rows(test.db, { kind: "prep" })).toHaveLength(0);
    });
  });

  describe("snooze and archive", () => {
    it("a snoozed task is silent until the snooze ends", async () => {
      await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      await createPreparation(ctx("2026-06-15"), task.id, {
        title: "x",
        kind: "generic",
        leadDays: 30,
        qty: 1,
      });
      await snoozeTask(ctx("2026-06-15"), task.id, "2026-06-25");
      await runEvaluationCycle(ctx("2026-06-15", "09:00"));
      await runEvaluationCycle(ctx("2026-06-22", "09:00"));
      expect(rows(test.db)).toHaveLength(0);
      await runEvaluationCycle(ctx("2026-06-25", "09:00"));
      expect(
        rows(test.db, { kind: "overdue" }).length +
          rows(test.db, { kind: "prep" }).length,
      ).toBeGreaterThan(0);
    });

    it("archived tasks are silent", async () => {
      await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-16"),
      });
      await updateTask(ctx("2026-06-15"), task.id, { archived: true });
      await generateNotifications(ctx("2026-06-15", "09:00"));
      expect(rows(test.db)).toHaveLength(0);
    });
  });

  describe("daily digest", () => {
    async function busyHousehold() {
      const users = await household();
      await makeTask(ctx("2026-06-15"), {
        title: "Überfällig",
        trigger: everyDays(30, "2026-06-10"),
      });
      await makeTask(ctx("2026-06-15"), {
        title: "Heute",
        trigger: everyDays(30, "2026-06-15"),
      });
      await makeTask(ctx("2026-06-15"), {
        title: "Bald",
        trigger: everyDays(30, "2026-06-18"),
      });
      return users;
    }

    it("is sent once per person per day, after the digest time", async () => {
      const [anna, ben] = await busyHousehold();
      await generateNotifications(ctx("2026-06-15", "07:59"));
      expect(rows(test.db, { kind: "digest" })).toHaveLength(0);
      await generateNotifications(ctx("2026-06-15", "08:00"));
      const digests = rows(test.db, { kind: "digest" });
      expect(digests.map((r) => r.userId).sort()).toEqual(
        [anna.id, ben.id].sort(),
      );
      expect(digests[0]).toMatchObject({
        titleKey: "notification_digest",
        paramsJson: { overdue: 1, due: 1, soon: 1 },
        taskId: null,
        url: "/",
      });
      await generateNotifications(ctx("2026-06-15", "09:00"));
      await generateNotifications(ctx("2026-06-15", "23:59"));
      expect(rows(test.db, { kind: "digest" })).toHaveLength(2);
      await generateNotifications(ctx("2026-06-16", "08:30"));
      expect(rows(test.db, { kind: "digest" })).toHaveLength(4);
    });

    it("uses the household's digest time and zone", async () => {
      const [anna] = await busyHousehold();
      updateHousehold(ctx("2026-06-15"), { settings: { digestTime: "18:30" } });
      await generateNotifications(ctx("2026-06-15", "18:29"));
      expect(rows(test.db, { kind: "digest", userId: anna.id })).toHaveLength(
        0,
      );
      await generateNotifications(ctx("2026-06-15", "18:30"));
      expect(rows(test.db, { kind: "digest", userId: anna.id })).toHaveLength(
        1,
      );
    });

    it("only counts what concerns the person", async () => {
      const [anna, ben] = await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-10"),
        assignMode: "fixed",
        assigneeUserId: ben.id,
      });
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-15"),
      });
      await generateNotifications(ctx("2026-06-15", "09:00"));
      expect(
        rows(test.db, { kind: "digest", userId: anna.id })[0].paramsJson,
      ).toEqual({ overdue: 0, due: 1, soon: 0 });
      expect(
        rows(test.db, { kind: "digest", userId: ben.id })[0].paramsJson,
      ).toEqual({ overdue: 1, due: 1, soon: 0 });
    });

    it("is skipped when there is nothing to report", async () => {
      await household();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-09-01"),
      });
      await generateNotifications(ctx("2026-06-15", "09:00"));
      expect(rows(test.db)).toHaveLength(0);
    });

    it("leaves out snoozed tasks", async () => {
      await household();
      const task = await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-10"),
      });
      await snoozeTask(ctx("2026-06-15"), task.id, "2026-06-30");
      await generateNotifications(ctx("2026-06-15", "09:00"));
      expect(rows(test.db, { kind: "digest" })).toHaveLength(0);
    });
  });

  describe("channels", () => {
    it("delivers each new notification once, to the people it concerns", async () => {
      const [anna, ben] = await household();
      const deliver = vi.fn<NotificationChannel["deliver"]>(() => []);
      const unregister = registerNotificationChannel({ name: "test", deliver });
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(deliver).toHaveBeenCalledTimes(2);
      const targets = deliver.mock.calls.map(([n, recipient]) => [
        n.userId,
        [recipient.id],
      ]);
      expect(targets).toContainEqual([anna.id, [anna.id]]);
      expect(targets).toContainEqual([ben.id, [ben.id]]);
      expect(deliver.mock.calls[0][0]).toMatchObject({
        kind: "due_soon",
        titleKey: "notification_due_soon",
        params: { date: "2026-06-20" },
      });
      await generateNotifications(ctx("2026-06-15", "07:10"));
      expect(deliver).toHaveBeenCalledTimes(2);
      unregister();
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-21"),
      });
      await generateNotifications(ctx("2026-06-15", "07:20"));
      expect(deliver).toHaveBeenCalledTimes(2);
    });

    it("a failing channel is logged by name and does not block others or the notifications", async () => {
      await household();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const good = vi.fn<NotificationChannel["deliver"]>(() => []);
      const stop = [
        registerNotificationChannel({
          name: "broken",
          deliver: () => {
            throw new TypeError("leaky detail");
          },
        }),
        registerNotificationChannel({ name: "good", deliver: good }),
      ];
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      expect(await generateNotifications(ctx("2026-06-15", "07:00"))).toEqual({
        created: 2,
      });
      expect(good).toHaveBeenCalledTimes(2);
      expect(rows(test.db)).toHaveLength(2);
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain('"channel":"broken"');
      expect(logged).not.toContain("leaky detail");
      stop.forEach((f) => f());
    });

    it("registering a channel under the same name replaces it", async () => {
      await household();
      const [first, second] = [
        vi.fn<NotificationChannel["deliver"]>(() => []),
        vi.fn<NotificationChannel["deliver"]>(() => []),
      ];
      const stop1 = registerNotificationChannel({
        name: "same",
        deliver: first,
      });
      const stop2 = registerNotificationChannel({
        name: "same",
        deliver: second,
      });
      await makeTask(ctx("2026-06-15"), {
        trigger: everyDays(30, "2026-06-20"),
      });
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
      stop1();
      stop2();
    });
  });

  it("rows survive deleting nothing else: dedupe keys are unique per person", async () => {
    await household();
    await makeTask(ctx("2026-06-15"), { trigger: everyDays(30, "2026-06-20") });
    await generateNotifications(ctx("2026-06-15", "07:00"));
    const keys = rows(test.db).map((r) => r.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      test.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.kind, "due_soon")))
        .all(),
    ).toHaveLength(2);
  });
});
