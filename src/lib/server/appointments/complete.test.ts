import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { taskCompletions } from "$lib/server/db";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { evaluateTaskById } from "$lib/server/tasks/evaluator";
import { setSignalProvider } from "$lib/server/tasks/signals";
import { getTask, updateTask } from "$lib/server/tasks/tasks";
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
import {
  createAppointment,
  getAppointment,
  updateAppointment,
  type CreateAppointmentInput,
} from "./appointments";
import { appointmentKey, completeAppointment } from "./complete";

describe("completing an appointment", () => {
  const test = useTestDB();
  const ctx = (now: number = NOW) => ctxAt(test.db, now);
  const HOUR = 3_600_000;
  const LATER = NOW + HOUR;

  async function world() {
    const user = await createTestUser();
    const task = await makeTask(ctx(), {
      title: "Heizung warten",
      trigger: everyDays(30, "2026-06-10"),
    });
    const input = { userId: user.id, source: "manual" as const };
    const make = (over: Partial<CreateAppointmentInput> = {}) =>
      createAppointment(
        ctx(),
        {
          title: "Service",
          startsAt: at("2026-06-20", "09:00"),
          endsAt: at("2026-06-20", "10:00"),
          taskId: task.id,
          ...over,
        },
        user.id,
      );
    const completions = (taskId = task.id) =>
      test.db
        .select()
        .from(taskCompletions)
        .where(eq(taskCompletions.taskId, taskId))
        .all();
    return { user, task, input, make, completions };
  }

  it("marks the appointment done and completes the occurrence the task shows", async () => {
    const { task, input, make, completions } = await world();
    const a = make();
    expect(task.state?.status).toBe("overdue");
    const result = await completeAppointment(ctx(LATER), a.id, {
      ...input,
      note: "Alles in Ordnung",
    });
    expect(result.replayed).toBe(false);
    expect(result.appointment).toMatchObject({
      id: a.id,
      status: "done",
      updatedAt: new Date(LATER),
    });
    const [row] = completions();
    expect(row).toMatchObject({
      taskId: task.id,
      kind: "done",
      source: "manual",
      userId: input.userId,
      note: "Alles in Ordnung",
      occurrenceKey: task.state!.occurrenceKey,
      idempotencyKey: `appointment:${a.id}`,
      completedAt: new Date(LATER),
    });
    expect(result.completion).toMatchObject({
      id: row.id,
      taskTitle: "Heizung warten",
    });
    expect(result.task?.state?.status).not.toBe("overdue");
    expect(result.task?.nextAppointment).toBeNull();
    expect(result.task?.state?.occurrenceKey).not.toBe(
      task.state!.occurrenceKey,
    );
  });

  it("completes the occurrence the appointment is for", async () => {
    const { task, input, make, completions } = await world();
    const a = make({ occurrenceKey: task.state!.occurrenceKey });
    await completeAppointment(ctx(), a.id, input);
    expect(completions()[0].occurrenceKey).toBe(task.state!.occurrenceKey);
  });

  it("only marks an appointment without a task done", async () => {
    const { input, make } = await world();
    const a = make({ taskId: null });
    const result = await completeAppointment(ctx(LATER), a.id, input);
    expect(result).toMatchObject({
      appointment: { status: "done" },
      completion: null,
      task: null,
      replayed: false,
    });
    expect(test.db.select().from(taskCompletions).all()).toEqual([]);
    const again = await completeAppointment(ctx(LATER), a.id, input);
    expect(again.replayed).toBe(true);
    expect(again.appointment.updatedAt).toEqual(new Date(LATER));
  });

  it("completes nothing twice and answers a repeat with the first completion", async () => {
    const { input, make, completions } = await world();
    const a = make();
    const first = await completeAppointment(ctx(), a.id, input);
    const second = await completeAppointment(ctx(LATER), a.id, input);
    expect(second.replayed).toBe(true);
    expect(second.completion?.id).toBe(first.completion?.id);
    expect(second.task?.id).toBe(first.task?.id);
    expect(second.appointment.updatedAt).toEqual(new Date(NOW));
    expect(completions()).toHaveLength(1);
  });

  it("completes once when two requests race", async () => {
    const { input, make, completions } = await world();
    const a = make();
    const [one, two] = await Promise.all([
      completeAppointment(ctx(), a.id, input),
      completeAppointment(ctx(), a.id, input),
    ]);
    expect(one.completion?.id).toBe(two.completion?.id);
    expect(completions()).toHaveLength(1);
    expect(getAppointment(ctx(), a.id).status).toBe("done");
  });

  it("answers a repeat with the first completion although the task has moved on", async () => {
    const { task, input, make, completions } = await world();
    const a = make({ occurrenceKey: task.state!.occurrenceKey });
    const first = await completeAppointment(ctx(), a.id, input);
    const second = await completeAppointment(ctx(LATER), a.id, input);
    expect(second.replayed).toBe(true);
    expect(second.completion?.id).toBe(first.completion?.id);
    expect(completions()).toHaveLength(1);
  });

  it("keeps the appointment done when the completion is undone, and completes again on request", async () => {
    const { user, input, make, completions } = await world();
    const a = make();
    const first = await completeAppointment(ctx(), a.id, input);
    await undoCompletion(ctx(LATER), first.completion!.id, user.id);
    expect(getAppointment(ctx(), a.id).status).toBe("done");

    const again = await completeAppointment(ctx(LATER), a.id, input);
    expect(again.replayed).toBe(false);
    expect(again.completion?.id).not.toBe(first.completion?.id);
    expect(
      completions()
        .map((c) => c.idempotencyKey)
        .sort(),
    ).toEqual([appointmentKey(a.id), appointmentKey(a.id, 2)]);
    expect(completions().filter((c) => !c.revokedAt)).toHaveLength(1);
    const third = await completeAppointment(ctx(LATER), a.id, input);
    expect(third.replayed).toBe(true);
    expect(third.completion?.id).toBe(again.completion?.id);
  });

  it("completes again after the appointment was reopened and its completion undone", async () => {
    const { user, input, make, completions } = await world();
    const a = make();
    const first = await completeAppointment(ctx(), a.id, input);
    await undoCompletion(ctx(LATER), first.completion!.id, user.id);
    updateAppointment(ctx(LATER), a.id, { status: "planned" });
    const again = await completeAppointment(ctx(LATER), a.id, input);
    expect(again.replayed).toBe(false);
    expect(again.completion?.id).not.toBe(first.completion?.id);
    expect(completions().filter((c) => !c.revokedAt)).toHaveLength(1);
    expect(again.appointment.status).toBe("done");
  });

  it("does not undo the completion when the appointment is reopened, and a new completion repeats the first", async () => {
    const { input, make, completions } = await world();
    const a = make();
    const first = await completeAppointment(ctx(), a.id, input);
    updateAppointment(ctx(LATER), a.id, { status: "planned" });
    expect(completions().filter((c) => !c.revokedAt)).toHaveLength(1);
    const again = await completeAppointment(ctx(LATER), a.id, input);
    expect(again.appointment.status).toBe("done");
    expect(again.completion?.id).toBe(first.completion?.id);
    expect(completions()).toHaveLength(1);
  });

  it("completes the task of an appointment that was set to done without it", async () => {
    const { input, make, completions } = await world();
    const a = make();
    updateAppointment(ctx(), a.id, { status: "done" });
    expect(completions()).toEqual([]);
    const result = await completeAppointment(ctx(LATER), a.id, input);
    expect(result.replayed).toBe(false);
    expect(result.completion).not.toBeNull();
    expect(completions()).toHaveLength(1);
    expect(result.appointment.updatedAt).toEqual(new Date(NOW));
  });

  it("refuses a cancelled appointment and writes nothing", async () => {
    const { input, make, completions } = await world();
    const a = make();
    updateAppointment(ctx(), a.id, { status: "cancelled" });
    await expect(
      completeAppointment(ctx(LATER), a.id, input),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(completions()).toEqual([]);
    expect(getAppointment(ctx(), a.id).status).toBe("cancelled");
  });

  it("is a 404 for an appointment that does not exist", async () => {
    const { input } = await world();
    await expect(
      completeAppointment(ctx(), "nope", input),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("leaves an archived task alone but marks the appointment done", async () => {
    const { task, input, make, completions } = await world();
    const a = make();
    await updateTask(ctx(), task.id, { archived: true });
    const result = await completeAppointment(ctx(LATER), a.id, input);
    expect(result.appointment.status).toBe("done");
    expect(result.completion).toBeNull();
    expect(result.task?.archivedAt).not.toBeNull();
    expect(completions()).toEqual([]);
  });

  it("leaves a task alone whose occurrence was settled meanwhile", async () => {
    const { task, input, make, completions } = await world();
    const a = make({ occurrenceKey: task.state!.occurrenceKey });
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: input.userId,
    });
    const result = await completeAppointment(ctx(LATER), a.id, input);
    expect(result.appointment.status).toBe("done");
    expect(result.completion).toBeNull();
    expect(result.task?.id).toBe(task.id);
    expect(completions()).toHaveLength(1);
  });

  const visit = (
    taskId: string,
    userId: string,
    day: string,
    over: Partial<CreateAppointmentInput> = {},
  ) =>
    createAppointment(
      ctx(),
      {
        title: "Besuch",
        startsAt: at(day, "09:00"),
        endsAt: at(day, "10:00"),
        taskId,
        ...over,
      },
      userId,
    );
  const unpin = (id: string) =>
    updateAppointment(ctx(), id, { occurrenceKey: null });
  const byHand = (
    taskId: string,
    userId: string,
    kind: "done" | "skipped" = "done",
  ) => completeTask(ctx(), taskId, { kind, source: "manual", userId });
  const oneOff = (date: string) => ({
    v: 1 as const,
    type: "one_off" as const,
    date,
  });

  describe("an occurrence settled by hand meanwhile", () => {
    it("is not completed a second time: the appointment pinned the occurrence the task showed", async () => {
      const { user, task, input, make, completions } = await world();
      const a = make();
      expect(a.occurrenceKey).toBe(task.state!.occurrenceKey);
      await byHand(task.id, user.id);
      const shown = getTask(ctx(), task.id).state!.occurrenceKey;
      expect(shown).not.toBe(a.occurrenceKey);
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.appointment.status).toBe("done");
      expect(result.completion).toBeNull();
      expect(result.task?.state?.occurrenceKey).toBe(shown);
      expect(completions()).toHaveLength(1);
    });

    it("does not skip a cycle of a weekly calendar task", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), {
        title: "Mülltonne rausstellen",
        trigger: weekly("2026-06-15"),
      });
      expect(task.state?.occurrenceKey).toBe("2026-06-15");
      const a = visit(task.id, user.id, "2026-06-16");
      await byHand(task.id, user.id);
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe("2026-06-22");
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(result.appointment.status).toBe("done");
      const rows = completions(task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].occurrenceKey).toBe("2026-06-15");
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe("2026-06-22");
    });

    it("leaves a one-off task alone whose key does not change when it is done", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), { trigger: oneOff("2026-06-18") });
      const a = visit(task.id, user.id, "2026-06-18");
      expect(a.occurrenceKey).toBe("2026-06-18");
      await byHand(task.id, user.id);
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe("2026-06-18");
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(result.appointment.status).toBe("done");
      expect(completions(task.id)).toHaveLength(1);
    });

    it("leaves a one-off task alone that was skipped", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), { trigger: oneOff("2026-06-18") });
      const a = visit(task.id, user.id, "2026-06-18");
      await byHand(task.id, user.id, "skipped");
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toHaveLength(1);
    });

    it("leaves a one-off task alone whose date was edited after it was done", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), { trigger: oneOff("2026-06-18") });
      await byHand(task.id, user.id);
      await updateTask(ctx(), task.id, { trigger: oneOff("2026-06-25") });
      const a = visit(task.id, user.id, "2026-06-25");
      expect(a.occurrenceKey).toBe("2026-06-25");
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toHaveLength(1);
    });

    it("still completes a period that wants more than one completion", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), {
        title: "Lüften",
        trigger: { v: 1, type: "min_per_period", period: "month", count: 2 },
      });
      const a = visit(task.id, user.id, "2026-06-20");
      expect(a.occurrenceKey).toBe("p:2026-06-01");
      await byHand(task.id, user.id);
      expect(getTask(ctx(), task.id).state).toMatchObject({
        occurrenceKey: "p:2026-06-01",
        progress: { current: 1, target: 2 },
      });
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion?.occurrenceKey).toBe("p:2026-06-01");
      expect(completions(task.id)).toHaveLength(2);
      expect(result.task?.state?.occurrenceKey).toBe("p:2026-07-01");
    });

    it("completes the occurrence after the completion by hand was undone", async () => {
      const { user, task, input, make, completions } = await world();
      const a = make();
      const { completion } = await byHand(task.id, user.id);
      await undoCompletion(ctx(LATER), completion.id, user.id);
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion?.occurrenceKey).toBe(a.occurrenceKey);
      expect(completions().filter((c) => !c.revokedAt)).toHaveLength(1);
    });
  });

  describe("an appointment without an occurrence", () => {
    it("completes the occurrence the task shows when that was due by the end of the appointment", async () => {
      const { user, task, input, completions } = await world();
      const a = unpin(visit(task.id, user.id, "2026-06-20").id);
      expect(a.occurrenceKey).toBeNull();
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).not.toBeNull();
      expect(completions()).toHaveLength(1);
      expect(completions()[0].occurrenceKey).toBe(task.state!.occurrenceKey);
    });

    it("counts the last day of the appointment: an end at midnight belongs to the day before", async () => {
      const { user, input } = await world();
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-21"),
      });
      const night = unpin(
        visit(task.id, user.id, "2026-06-20", {
          startsAt: at("2026-06-20", "22:00"),
          endsAt: at("2026-06-21", "02:00"),
        }).id,
      );
      const evening = unpin(
        visit(task.id, user.id, "2026-06-20", {
          startsAt: at("2026-06-20", "22:00"),
          endsAt: at("2026-06-21", "00:00"),
        }).id,
      );
      expect(
        (await completeAppointment(ctx(LATER), evening.id, input)).completion,
      ).toBeNull();
      expect(
        (await completeAppointment(ctx(LATER), night.id, input)).completion,
      ).not.toBeNull();
    });

    it("counts the last day of an all-day appointment", async () => {
      const { user, input } = await world();
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-22"),
      });
      const span = unpin(
        createAppointment(
          ctx(),
          {
            title: "Handwerker im Haus",
            allDay: true,
            startDate: "2026-06-20",
            endDate: "2026-06-22",
            taskId: task.id,
          },
          user.id,
        ).id,
      );
      const result = await completeAppointment(ctx(LATER), span.id, input);
      expect(result.completion).not.toBeNull();
    });

    it("does not complete an occurrence that falls due after the appointment", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-07-01"),
      });
      const a = unpin(visit(task.id, user.id, "2026-06-20").id);
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.appointment.status).toBe("done");
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toEqual([]);
    });

    it("does not skip a cycle when the task was completed by hand meanwhile", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), { trigger: weekly("2026-06-15") });
      const a = unpin(visit(task.id, user.id, "2026-06-16").id);
      await byHand(task.id, user.id);
      expect(getTask(ctx(), task.id).state?.occurrenceKey).toBe("2026-06-22");
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toHaveLength(1);
    });

    it("leaves a one-off task alone that was done meanwhile", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), { trigger: oneOff("2026-06-18") });
      const a = unpin(visit(task.id, user.id, "2026-06-18").id);
      await byHand(task.id, user.id);
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toHaveLength(1);
    });

    it("leaves a task alone that has no date to compare", async () => {
      const { user, input, completions } = await world();
      const task = await makeTask(ctx(), {
        trigger: {
          v: 1,
          type: "counter_delta",
          entityId: "sensor.example_counter",
          threshold: 50,
        },
      });
      expect(task.state).toMatchObject({ dueDate: null });
      const a = unpin(visit(task.id, user.id, "2026-06-20").id);
      const result = await completeAppointment(ctx(LATER), a.id, input);
      expect(result.completion).toBeNull();
      expect(completions(task.id)).toEqual([]);
    });

    describe("of a task whose condition did not hold when it was planned", () => {
      const condition = {
        v: 1 as const,
        type: "state_condition" as const,
        entityId: "binary_sensor.example_filter",
        op: "eq" as const,
        value: "on",
      };
      afterEach(() => setSignalProvider(null));

      async function idleWorld() {
        const { user, input } = await world();
        const task = await makeTask(ctx(), { trigger: condition });
        expect(task.state?.occurrenceKey).toBe("s:none");
        const a = visit(task.id, user.id, "2026-06-20");
        expect(a.occurrenceKey).toBeNull();
        const conditionHolds = async (since: number) => {
          setSignalProvider({
            load: () => ({
              signals: {
                [condition.entityId]: {
                  text: "on",
                  changedAt: since,
                  seenAt: since,
                },
              },
            }),
          });
          await evaluateTaskById(ctx(since), task.id);
        };
        const completions = () =>
          test.db
            .select()
            .from(taskCompletions)
            .where(eq(taskCompletions.taskId, task.id))
            .all();
        return { user, task, a, input, conditionHolds, completions };
      }

      it("leaves the task alone while it still shows none", async () => {
        const { a, input, completions } = await idleWorld();
        const result = await completeAppointment(ctx(LATER), a.id, input);
        expect(result.appointment.status).toBe("done");
        expect(result.completion).toBeNull();
        expect(completions()).toEqual([]);
      });

      it("completes the occurrence that arose before the appointment took place", async () => {
        const { task, a, input, conditionHolds } = await idleWorld();
        const since = at("2026-06-17", "08:00");
        await conditionHolds(since);
        expect(getTask(ctx(), task.id).state).toMatchObject({
          occurrenceKey: `s:${since}`,
          dueDate: "2026-06-17",
        });
        const result = await completeAppointment(
          ctx(since + HOUR),
          a.id,
          input,
        );
        expect(result.completion?.occurrenceKey).toBe(`s:${since}`);
      });

      it("leaves an occurrence alone that somebody acknowledged by hand", async () => {
        const { task, user, input, conditionHolds, completions } =
          await idleWorld();
        const since = at("2026-06-17", "08:00");
        await conditionHolds(since);
        const pinned = visit(task.id, user.id, "2026-06-20");
        expect(pinned.occurrenceKey).toBe(`s:${since}`);
        await completeTask(ctx(since + HOUR), task.id, {
          kind: "done",
          source: "manual",
          userId: user.id,
        });
        expect(getTask(ctx(), task.id).state).toMatchObject({
          occurrenceKey: `s:${since}`,
          reasons: ["acknowledged"],
        });
        const result = await completeAppointment(
          ctx(since + 2 * HOUR),
          pinned.id,
          input,
        );
        expect(result.completion).toBeNull();
        expect(completions()).toHaveLength(1);
      });

      it("leaves an occurrence alone that arose after the appointment", async () => {
        const { a, input, conditionHolds, completions } = await idleWorld();
        const since = at("2026-06-22", "08:00");
        await conditionHolds(since);
        const result = await completeAppointment(
          ctx(since + HOUR),
          a.id,
          input,
        );
        expect(result.completion).toBeNull();
        expect(completions()).toEqual([]);
      });
    });
  });

  it("completes the task the appointment belongs to now when it was moved to another one", async () => {
    const { task, input, make, completions } = await world();
    const other = await makeTask(ctx(), {
      title: "Boiler entkalken",
      trigger: everyDays(30, "2026-06-10"),
    });
    const a = make();
    await completeAppointment(ctx(), a.id, input);
    updateAppointment(ctx(LATER), a.id, {
      taskId: other.id,
      status: "planned",
    });
    const result = await completeAppointment(ctx(LATER), a.id, input);
    expect(result.replayed).toBe(false);
    expect(result.task?.id).toBe(other.id);
    expect(completions(other.id)).toHaveLength(1);
    expect(completions(task.id)).toHaveLength(1);
  });

  it("backdates the completion of the task and refuses the future", async () => {
    const { input, make, completions } = await world();
    const a = make();
    const yesterday = at("2026-06-14", "10:00");
    await completeAppointment(ctx(), a.id, {
      ...input,
      completedAt: yesterday,
    });
    expect(completions()[0]).toMatchObject({
      completedAt: new Date(yesterday),
      completedDate: "2026-06-14",
    });
    const b = make({ title: "Zweiter" });
    await expect(
      completeAppointment(ctx(), b.id, {
        ...input,
        completedAt: NOW + 24 * 3_600_000,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(getAppointment(ctx(), b.id).status).toBe("planned");
  });

  it("attributes the completion by the source it is given", async () => {
    const { input, make, completions } = await world();
    const a = make();
    await completeAppointment(ctx(), a.id, { ...input, source: "mcp" });
    expect(completions()[0].source).toBe("mcp");
  });
});
