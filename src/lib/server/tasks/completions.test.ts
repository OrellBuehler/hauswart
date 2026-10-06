import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { taskCompletions, tasks } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import {
  completeTask,
  getCompletion,
  listCompletions,
  recentCompletions,
  recentCompletionsOf,
  undoCompletion,
  type CompleteInput,
} from "./completions";
import { getTask } from "./tasks";

const DAY = 24 * 60 * 60 * 1000;

describe("completions", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const complete = (
    taskId: string,
    input: Partial<CompleteInput> = {},
    now = NOW,
  ) =>
    completeTask(ctx(now), taskId, {
      kind: "done",
      source: "manual",
      userId: null,
      ...input,
    });
  const count = () => test.db.select().from(taskCompletions).all().length;

  it("records who, how and when, in the household's calendar day", async () => {
    const user = await createTestUser({ displayName: "Anna Muster" });
    const task = await makeTask(ctx(), { title: "Filter wechseln" });
    const { completion, replayed } = await complete(task.id, {
      userId: user.id,
      source: "qr",
      note: "neuer Filter",
    });
    expect(replayed).toBe(false);
    expect(completion).toMatchObject({
      taskId: task.id,
      taskTitle: "Filter wechseln",
      userId: user.id,
      userName: "Anna Muster",
      source: "qr",
      kind: "done",
      note: "neuer Filter",
      completedDate: "2026-06-15",
      revokedAt: null,
    });
    expect(completion.completedAt.getTime()).toBe(NOW);
  });

  it("falls back to the username when there is no display name", async () => {
    const user = await createTestUser({ username: "bernd" });
    const task = await makeTask(ctx());
    const { completion } = await complete(task.id, { userId: user.id });
    expect(completion.userName).toBe("bernd");
  });

  it("works out the date in the household zone, not UTC", async () => {
    const task = await makeTask(ctx());
    const lateEvening = at("2026-06-14", "23:30");
    const { completion } = await complete(task.id, {
      completedAt: lateEvening,
    });
    expect(completion.completedDate).toBe("2026-06-14");
    const afterMidnight = at("2026-06-15", "00:30");
    const second = await complete(task.id, { completedAt: afterMidnight });
    expect(second.completion.completedDate).toBe("2026-06-15");
  });

  it("takes the due date and occurrence from what the task shows", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-10"),
    });
    const { completion } = await complete(task.id);
    expect(completion).toMatchObject({
      occurrenceKey: "2026-06-10",
      dueDateAtCompletion: "2026-06-10",
    });
  });

  it("an explicit occurrence has no known due date", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-10"),
    });
    const { completion } = await complete(task.id, {
      occurrenceKey: "2026-05-10",
    });
    expect(completion).toMatchObject({
      occurrenceKey: "2026-05-10",
      dueDateAtCompletion: null,
    });
  });

  it("stores no occurrence for tasks that show none", async () => {
    const task = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "ha_calendar",
        entityId: "calendar.abfall",
        offsetDays: 0,
      },
    });
    expect(task.state?.occurrenceKey).toBe("none");
    expect((await complete(task.id)).completion).toMatchObject({
      occurrenceKey: null,
      dueDateAtCompletion: null,
    });
  });

  it("stores the counter reading and a skip as a skip", async () => {
    const task = await makeTask(ctx());
    const first = await complete(task.id, { counterValue: 1234.5 });
    expect(first.completion.counterValue).toBe(1234.5);
    const skip = await complete(task.id, { kind: "skipped" });
    expect(skip.completion.kind).toBe("skipped");
  });

  describe("idempotency", () => {
    it("returns the first completion for a repeated key and writes nothing", async () => {
      const task = await makeTask(ctx());
      const first = await complete(task.id, { idempotencyKey: "retry-key-1" });
      const second = await complete(task.id, {
        idempotencyKey: "retry-key-1",
        note: "ignored on replay",
      });
      expect(second.replayed).toBe(true);
      expect(second.completion.id).toBe(first.completion.id);
      expect(second.completion.note).toBeNull();
      expect(second.task.state?.dueDate).toBe(first.task.state?.dueDate);
      expect(count()).toBe(1);
    });

    it("different keys write different completions", async () => {
      const task = await makeTask(ctx());
      await complete(task.id, { idempotencyKey: "key-aaaaaaaa" });
      await complete(task.id, { idempotencyKey: "key-bbbbbbbb" });
      expect(count()).toBe(2);
    });

    it("refuses a key that was used for another task", async () => {
      const [a, b] = [await makeTask(ctx()), await makeTask(ctx())];
      await complete(a.id, { idempotencyKey: "shared-key-1" });
      await expect(
        complete(b.id, { idempotencyKey: "shared-key-1" }),
      ).rejects.toMatchObject({
        code: "conflict",
      });
      expect(count()).toBe(1);
    });

    it("a replay still works after the task was edited or completed again", async () => {
      const task = await makeTask(ctx());
      const first = await complete(task.id, { idempotencyKey: "replay-key-1" });
      await complete(task.id);
      const replay = await complete(task.id, {
        idempotencyKey: "replay-key-1",
      });
      expect(replay.completion.id).toBe(first.completion.id);
      expect(count()).toBe(2);
    });
  });

  describe("rules", () => {
    it("refuses completions in the future but allows a little clock skew", async () => {
      const task = await makeTask(ctx());
      await expect(
        complete(task.id, { completedAt: NOW + DAY }),
      ).rejects.toMatchObject({
        code: "invalid_request",
      });
      await complete(task.id, { completedAt: NOW + 60_000 });
      expect(count()).toBe(1);
    });

    it("allows backdating", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-01"),
      });
      const { task: after } = await complete(task.id, {
        completedAt: at("2026-06-05"),
      });
      expect(after.state?.dueDate).toBe("2026-07-05");
    });

    it("404s for unknown tasks and refuses archived ones", async () => {
      await expect(complete("nope")).rejects.toMatchObject({
        code: "not_found",
      });
      const task = await makeTask(ctx());
      test.db
        .update(tasks)
        .set({ archivedAt: new Date(NOW) })
        .run();
      await expect(complete(task.id)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("warranty tasks settle on the completion", async () => {
      const task = await makeTask(ctx(), {
        trigger: { v: 1, type: "warranty", until: "2026-07-01" },
      });
      expect(task.state?.status).toBe("open");
      const { task: after } = await complete(task.id);
      expect(after.state?.status).toBe("ok");
      expect(after.state?.reasons).toContain("completed");
    });
  });

  describe("undo", () => {
    it("revokes softly and keeps the row", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const task = await makeTask(ctx());
      const { completion } = await complete(task.id, { userId: anna.id });
      await undoCompletion(ctx(NOW + DAY), completion.id, ben.id);
      const row = test.db
        .select()
        .from(taskCompletions)
        .where(eq(taskCompletions.id, completion.id))
        .get();
      expect(row?.revokedAt?.getTime()).toBe(NOW + DAY);
      expect(row?.revokedBy).toBe(ben.id);
      expect(getTask(ctx(), task.id).state?.dueDate).toBe("2026-06-20");
    });

    it("works within 7 days of recording and not after", async () => {
      const user = await createTestUser();
      const task = await makeTask(ctx());
      const a = (await complete(task.id)).completion;
      const b = (await complete(task.id)).completion;
      await undoCompletion(ctx(NOW + 7 * DAY), a.id, user.id);
      await expect(
        undoCompletion(ctx(NOW + 7 * DAY + 1000), b.id, user.id),
      ).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("counts the window from when it was recorded, so a backdated entry can still be undone", async () => {
      const user = await createTestUser();
      const task = await makeTask(ctx());
      const { completion } = await complete(task.id, {
        completedAt: NOW - 30 * DAY,
      });
      await undoCompletion(ctx(NOW + DAY), completion.id, user.id);
      expect(getCompletion(ctx(), completion.id).revokedAt).not.toBeNull();
    });

    it("undoing twice is not an error and keeps the first revocation", async () => {
      const user = await createTestUser();
      const task = await makeTask(ctx());
      const { completion } = await complete(task.id);
      await undoCompletion(ctx(NOW + 1000), completion.id, user.id);
      await undoCompletion(ctx(NOW + 2000), completion.id, user.id);
      expect(getCompletion(ctx(), completion.id).revokedAt?.getTime()).toBe(
        NOW + 1000,
      );
    });

    it("404s for unknown completions", async () => {
      await expect(undoCompletion(ctx(), "nope", "u")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("listing", () => {
    it("lists newest first without revoked ones and pages with a stable cursor", async () => {
      const task = await makeTask(ctx());
      const user = await createTestUser();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(
          (await complete(task.id, { completedAt: NOW - i * 60_000 }))
            .completion.id,
        );
      }
      await undoCompletion(ctx(), ids[2], user.id);
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = listCompletions(ctx(), {}, { limit: 2, cursor });
        seen.push(...page.items.map((c) => c.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual([ids[0], ids[1], ids[3], ids[4]]);
      expect(
        listCompletions(ctx(), { includeRevoked: true }, { limit: 50 }).items,
      ).toHaveLength(5);
    });

    it("pages through completions that share a timestamp without repeats or gaps", async () => {
      const task = await makeTask(ctx());
      for (let i = 0; i < 5; i += 1) await complete(task.id);
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = listCompletions(ctx(), {}, { limit: 2, cursor });
        for (const c of page.items) {
          expect(seen.has(c.id)).toBe(false);
          seen.add(c.id);
        }
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);
      expect(seen.size).toBe(5);
      expect(pages).toBe(3);
    });

    it("filters by task and user", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      const [t1, t2] = [await makeTask(ctx()), await makeTask(ctx())];
      await complete(t1.id, { userId: anna.id });
      await complete(t2.id, { userId: ben.id });
      await complete(t2.id, { userId: anna.id });
      const ids = (filter: Parameters<typeof listCompletions>[1]) =>
        listCompletions(ctx(), filter, { limit: 50 }).items.map((c) => [
          c.taskId,
          c.userId,
        ]);
      expect(ids({ taskId: t1.id })).toEqual([[t1.id, anna.id]]);
      expect(ids({ userId: ben.id })).toEqual([[t2.id, ben.id]]);
      expect(ids({ taskId: t2.id, userId: anna.id })).toEqual([
        [t2.id, anna.id],
      ]);
    });

    it("rejects a forged cursor", () => {
      expect(() =>
        listCompletions(ctx(), {}, { limit: 5, cursor: "garbage" }),
      ).toThrow("Invalid request");
    });

    it("recent completions of one task and overall are capped", async () => {
      const [t1, t2] = [await makeTask(ctx()), await makeTask(ctx())];
      for (let i = 0; i < 4; i += 1)
        await complete(t1.id, { completedAt: NOW - i * 1000 });
      await complete(t2.id);
      expect(recentCompletionsOf(ctx(), t1.id, 3)).toHaveLength(3);
      expect(recentCompletions(ctx(), 10)).toHaveLength(5);
      expect(recentCompletions(ctx(), 2)).toHaveLength(2);
    });
  });
});
