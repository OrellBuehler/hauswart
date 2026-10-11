import { describe, expect, it } from "vitest";
import { completeTask } from "$lib/server/tasks/completions";
import { getUpcomingTasks } from "$lib/server/tasks/dashboard";
import { getTask, listTasks } from "$lib/server/tasks/tasks";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import {
  createAppointment,
  updateAppointment,
  type CreateAppointmentInput,
} from "./appointments";
import { parseNextAppointment } from "./next";

describe("the next appointment of a task", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const task = (title = "Heizung warten") =>
    makeTask(ctx(), { title, trigger: everyDays(30, "2026-06-20") });
  const book = (
    taskId: string | null,
    day: string,
    over: Partial<CreateAppointmentInput> = {},
  ) =>
    createAppointment(
      ctx(),
      {
        title: `Termin ${day}`,
        startsAt: at(day, "09:00"),
        endsAt: at(day, "10:00"),
        taskId,
        ...over,
      },
      null,
    );
  const next = (taskId: string) => getTask(ctx(), taskId).nextAppointment;

  it("is null for a task without appointments", async () => {
    const t = await task();
    expect(next(t.id)).toBeNull();
    expect(t.nextAppointment).toBeNull();
  });

  it("points at a timed appointment with its start", async () => {
    const t = await task();
    const a = book(t.id, "2026-06-24");
    expect(next(t.id)).toEqual({
      id: a.id,
      allDay: false,
      startsAt: new Date(at("2026-06-24", "09:00")).toISOString(),
      startDate: null,
    });
  });

  it("points at an all-day appointment with its first day", async () => {
    const t = await task();
    const a = book(t.id, "2026-06-24", {
      allDay: true,
      startDate: "2026-06-25",
      endDate: "2026-06-26",
      startsAt: undefined,
      endsAt: undefined,
    });
    expect(next(t.id)).toEqual({
      id: a.id,
      allDay: true,
      startsAt: null,
      startDate: "2026-06-25",
    });
  });

  it("is the earliest planned one across both kinds", async () => {
    const t = await task();
    book(t.id, "2026-06-30");
    const early = book(t.id, "2026-06-24", {
      allDay: true,
      startDate: "2026-06-24",
      startsAt: undefined,
      endsAt: undefined,
    });
    book(t.id, "2026-06-27");
    expect(next(t.id)?.id).toBe(early.id);
  });

  it("skips what is done or cancelled and comes back when it is reopened", async () => {
    const t = await task();
    const first = book(t.id, "2026-06-24");
    const second = book(t.id, "2026-06-27");
    updateAppointment(ctx(), first.id, { status: "done" });
    expect(next(t.id)?.id).toBe(second.id);
    updateAppointment(ctx(), second.id, { status: "cancelled" });
    expect(next(t.id)).toBeNull();
    updateAppointment(ctx(), first.id, { status: "planned" });
    expect(next(t.id)?.id).toBe(first.id);
  });

  it("keeps an appointment whose time has passed until it is closed", async () => {
    const t = await task();
    const old = book(t.id, "2026-06-01");
    book(t.id, "2026-06-24");
    expect(next(t.id)?.id).toBe(old.id);
  });

  it("belongs to its own task only", async () => {
    const one = await task("Eins");
    const two = await task("Zwei");
    const a = book(one.id, "2026-06-24");
    book(null, "2026-06-23");
    expect(next(one.id)?.id).toBe(a.id);
    expect(next(two.id)).toBeNull();
  });

  it("is on the tasks of a list", async () => {
    await task("Eins");
    const two = await task("Zwei");
    const a = book(two.id, "2026-06-24");
    const { items } = listTasks(ctx(), {}, { limit: 50 }, "nobody");
    expect(
      Object.fromEntries(items.map((t) => [t.title, t.nextAppointment?.id])),
    ).toEqual({ Eins: undefined, Zwei: a.id });
  });

  it("is on the task a completion answers with", async () => {
    const t = await task();
    const a = book(t.id, "2026-06-24");
    const done = await completeTask(ctx(), t.id, {
      kind: "done",
      source: "manual",
      userId: null,
    });
    expect(done.task.nextAppointment?.id).toBe(a.id);
  });

  it("is on the tasks of the dashboard", async () => {
    const t = await task();
    const a = book(t.id, "2026-06-24");
    const other = await task("Ohne");
    const { upcoming } = await getUpcomingTasks(ctx());
    const rows = Object.values(upcoming).flat();
    expect(rows.find((r) => r.taskId === t.id)?.nextAppointment).toEqual({
      id: a.id,
      allDay: false,
      startsAt: new Date(at("2026-06-24", "09:00")).toISOString(),
      startDate: null,
    });
    expect(rows.find((r) => r.taskId === other.id)?.nextAppointment).toBeNull();
  });

  describe("parseNextAppointment", () => {
    it("reads what the subquery makes", () => {
      expect(
        parseNextAppointment(
          '{"id":"a1","allDay":1,"startsAt":null,"startDate":"2026-06-24"}',
        ),
      ).toEqual({
        id: "a1",
        allDay: true,
        startsAt: null,
        startDate: "2026-06-24",
      });
      expect(parseNextAppointment(null)).toBeNull();
    });

    it("refuses a value that is not what the subquery makes", () => {
      expect(() => parseNextAppointment('{"id":1}')).toThrow(
        /next appointment/,
      );
    });
  });
});
