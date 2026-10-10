import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createInsurancePolicyRequestSchema } from "$lib/api/schemas/insurance";
import { taskCompletions, tasks } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt } from "$lib/testing/domain";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { listPreparations } from "$lib/server/tasks/preparations";
import { getTask } from "$lib/server/tasks/tasks";
import {
  createPolicy,
  deletePolicy,
  getPolicy,
  updatePolicy,
} from "./policies";

describe("insurance reminder task", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const make = (over: Record<string, unknown> = {}, now?: number) =>
    createPolicy(
      ctx(now),
      createInsurancePolicyRequestSchema.parse({
        title: "Hausrat Muster",
        premiumMinor: 48_000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        cancellationNoticeMonths: 3,
        ...over,
      }),
    );
  const reminders = () =>
    test.db
      .select()
      .from(tasks)
      .where(eq(tasks.externalSource, "insurance"))
      .all();
  const active = () => reminders().filter((t) => t.archivedAt === null);

  it("is a one-off task on the cancellation deadline, due soon two weeks ahead, with a preparation a month ahead", async () => {
    const p = await make();
    const task = getTask(ctx(), p.reminderTaskId!);
    expect(task).toMatchObject({
      title: "Kündigungsfrist: Hausrat Muster",
      category: "payment",
      priority: "normal",
      source: "system",
      externalSource: "insurance",
      externalRef: p.id,
      externalUrl: `/insurance/${p.id}`,
      assignMode: "none",
      notifyMode: "all",
      assetId: null,
      roomId: null,
      dueSoonDays: 14,
      graceDays: 0,
      archivedAt: null,
      trigger: { v: 1, type: "one_off", date: "2026-09-30" },
    });
    expect(task.state).toMatchObject({ status: "ok", dueDate: "2026-09-30" });
    const preps = await listPreparations(ctx(), task.id);
    expect(preps).toHaveLength(1);
    expect(preps[0]).toMatchObject({
      title: "Prämie und Deckung vergleichen, Kündigung vorbereiten",
      kind: "generic",
      leadDays: 30,
      state: "not_yet",
    });
  });

  it("turns due soon two weeks before the deadline, due on it and overdue after", async () => {
    const p = await make();
    const status = async (date: string) => {
      // The evaluator re-reads the verdict when a task is touched; an edit that changes nothing does.
      await updatePolicy(ctx(at(date)), p.id, { notes: date });
      return getTask(ctx(), p.reminderTaskId!).state?.status;
    };
    expect(await status("2026-09-15")).toBe("ok");
    expect(await status("2026-09-16")).toBe("open");
    expect(await status("2026-09-30")).toBe("due");
  });

  it.each([
    ["a fixed term", { renewal: "fixed" }],
    ["no end date", { endDate: null }],
    ["no notice period", { cancellationNoticeMonths: null }],
    [
      "a deadline that has passed",
      { endDate: "2026-06-30", cancellationNoticeMonths: 1 },
    ],
  ])("is not created for %s", async (_name, over) => {
    const p = await make(over);
    expect(p.reminderTaskId).toBeNull();
    expect(reminders()).toEqual([]);
  });

  it("is created on the deadline day itself but not the day after", async () => {
    expect((await make({}, at("2026-09-30"))).reminderTaskId).not.toBeNull();
    expect(
      (await make({ title: "Spät" }, at("2026-10-01"))).reminderTaskId,
    ).toBeNull();
  });

  it("is not created for an archived policy", async () => {
    const p = await make();
    await updatePolicy(ctx(), p.id, { archived: true });
    expect(active()).toEqual([]);
  });

  it("follows the end date, the notice period and the title", async () => {
    const p = await make();
    const updated = await updatePolicy(ctx(), p.id, {
      title: "Neu",
      endDate: "2027-06-30",
      cancellationNoticeMonths: 6,
    });
    expect(updated.reminderTaskId).toBe(p.reminderTaskId);
    expect(getTask(ctx(), p.reminderTaskId!)).toMatchObject({
      title: "Kündigungsfrist: Neu",
      trigger: { type: "one_off", date: "2026-12-30" },
    });
    expect(reminders()).toHaveLength(1);
  });

  it("keeps one task when nothing about the deadline changes", async () => {
    const p = await make();
    await updatePolicy(ctx(), p.id, { notes: "x" });
    await updatePolicy(ctx(), p.id, { premiumMinor: 1 });
    expect(reminders()).toHaveLength(1);
    expect(await listPreparations(ctx(), p.reminderTaskId!)).toHaveLength(1);
  });

  it("is archived when the policy is archived and comes back when it is restored", async () => {
    const p = await make();
    expect(
      (await updatePolicy(ctx(), p.id, { archived: true })).reminderTaskId,
    ).toBeNull();
    expect(getTask(ctx(), p.reminderTaskId!).archivedAt).not.toBeNull();
    const back = await updatePolicy(ctx(), p.id, { archived: false });
    expect(back.reminderTaskId).toBe(p.reminderTaskId);
    expect(getTask(ctx(), p.reminderTaskId!).archivedAt).toBeNull();
    expect(reminders()).toHaveLength(1);
  });

  it.each([
    ["the contract becomes a fixed term", { renewal: "fixed" }],
    ["the end date is removed", { endDate: null }],
    ["the notice period is removed", { cancellationNoticeMonths: null }],
    [
      "the deadline is moved into the past",
      { endDate: "2026-06-30", cancellationNoticeMonths: 1 },
    ],
  ] as const)("is archived when %s", async (_name, patch) => {
    const p = await make();
    const updated = await updatePolicy(ctx(), p.id, patch);
    expect(updated.reminderTaskId).toBeNull();
    expect(getTask(ctx(), p.reminderTaskId!).archivedAt).not.toBeNull();
    // ... and the same task is used again when a deadline returns.
    const again = await updatePolicy(ctx(), p.id, {
      renewal: "auto",
      endDate: "2027-12-31",
      cancellationNoticeMonths: 3,
    });
    expect(again.reminderTaskId).toBe(p.reminderTaskId);
    expect(getTask(ctx(), p.reminderTaskId!)).toMatchObject({
      archivedAt: null,
      trigger: { date: "2027-09-30" },
    });
    expect(reminders()).toHaveLength(1);
  });

  it("is one task per policy", async () => {
    const a = await make();
    const b = await make({ title: "Zweite" });
    expect(a.reminderTaskId).not.toBe(b.reminderTaskId);
    expect(active()).toHaveLength(2);
  });

  describe("after it was done", () => {
    async function done(kind: "done" | "skipped" = "done") {
      const user = await createTestUser();
      const p = await make();
      const { completion } = await completeTask(ctx(), p.reminderTaskId!, {
        kind,
        source: "manual",
        userId: user.id,
      });
      return { p, user, completion };
    }

    it.each(["done", "skipped"] as const)(
      "gets a fresh task for a new deadline when it was %s, and keeps the old one with its history",
      async (kind) => {
        const { p, completion } = await done(kind);
        const renewed = await updatePolicy(ctx(), p.id, {
          endDate: "2027-12-31",
        });
        expect(renewed.cancellationDeadline).toBe("2027-09-30");
        expect(renewed.reminderTaskId).not.toBe(p.reminderTaskId);
        expect(getTask(ctx(), renewed.reminderTaskId!)).toMatchObject({
          externalRef: p.id,
          archivedAt: null,
          trigger: { date: "2027-09-30" },
          state: { status: "ok", dueDate: "2027-09-30" },
        });
        expect(
          await listPreparations(ctx(), renewed.reminderTaskId!),
        ).toHaveLength(1);
        const old = getTask(ctx(), p.reminderTaskId!);
        expect(old.archivedAt).not.toBeNull();
        expect(old.externalRef).toBe(`${p.id}@${old.id}`);
        expect(old.trigger).toMatchObject({ date: "2026-09-30" });
        expect(
          test.db
            .select()
            .from(taskCompletions)
            .where(eq(taskCompletions.id, completion.id))
            .get(),
        ).toBeDefined();
        expect(active()).toHaveLength(1);
      },
    );

    it("renews more than once without a clash of references", async () => {
      const { p, user } = await done();
      let latest = p.reminderTaskId!;
      for (const endDate of ["2027-12-31", "2026-12-31", "2027-12-31"]) {
        const updated = await updatePolicy(ctx(), p.id, { endDate });
        expect(updated.reminderTaskId).not.toBe(latest);
        latest = updated.reminderTaskId!;
        await completeTask(ctx(), latest, {
          kind: "done",
          source: "manual",
          userId: user.id,
        });
      }
      expect(reminders()).toHaveLength(4);
      expect(active()).toHaveLength(1);
      expect(new Set(reminders().map((t) => t.externalRef)).size).toBe(4);
    });

    it("keeps the finished task when only other things change", async () => {
      const { p } = await done();
      const updated = await updatePolicy(ctx(), p.id, { title: "Umbenannt" });
      expect(updated.reminderTaskId).toBe(p.reminderTaskId);
      expect(getTask(ctx(), p.reminderTaskId!)).toMatchObject({
        title: "Kündigungsfrist: Umbenannt",
        state: { status: "ok", reasons: ["completed"] },
      });
      expect(reminders()).toHaveLength(1);
    });

    it("moves an unfinished task in place, and one whose completion was undone", async () => {
      const { p, user, completion } = await done();
      await undoCompletion(ctx(), completion.id, user.id);
      const moved = await updatePolicy(ctx(), p.id, { endDate: "2027-12-31" });
      expect(moved.reminderTaskId).toBe(p.reminderTaskId);
      expect(getTask(ctx(), p.reminderTaskId!)).toMatchObject({
        trigger: { date: "2027-09-30" },
        state: { status: "ok", dueDate: "2027-09-30" },
      });
      expect(reminders()).toHaveLength(1);
    });
  });

  describe("deleting the policy", () => {
    it("removes the reminder task", async () => {
      const p = await make();
      deletePolicy(ctx(), p.id);
      expect(reminders()).toEqual([]);
    });

    it("removes the finished reminders of earlier deadlines too, and only that policy's", async () => {
      const user = await createTestUser();
      const p = await make();
      const other = await make({ title: "Andere" });
      await completeTask(ctx(), p.reminderTaskId!, {
        kind: "done",
        source: "manual",
        userId: user.id,
      });
      await updatePolicy(ctx(), p.id, { endDate: "2027-12-31" });
      expect(reminders()).toHaveLength(3);
      deletePolicy(ctx(), p.id);
      expect(reminders().map((t) => t.externalRef)).toEqual([other.id]);
      expect(getPolicy(ctx(), other.id).reminderTaskId).not.toBeNull();
    });
  });
});
