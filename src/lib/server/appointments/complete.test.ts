import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { taskCompletions } from "$lib/server/db";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { getTask, updateTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
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
  const LATER = NOW + 3_600_000;

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

  it("completes the occurrence the task shows when the appointment names none", async () => {
    const { task, input, make, completions } = await world();
    const a = make();
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: input.userId,
    });
    const shown = getTask(ctx(), task.id).state!.occurrenceKey;
    await completeAppointment(ctx(LATER), a.id, input);
    const rows = completions();
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r) => r.idempotencyKey?.startsWith("appointment:"))
        ?.occurrenceKey,
    ).toBe(shown);
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
