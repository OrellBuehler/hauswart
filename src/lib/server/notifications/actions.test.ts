import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import { notificationDeliveries, taskCompletions } from "$lib/server/db";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { deleteTask, updateTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import {
  ACTION_DONE_PREFIX,
  ACTION_TOKEN_TTL_MS,
  hashActionToken,
  mintActionToken,
  parseDoneAction,
  performDoneAction,
} from "./actions";
import { registerNotificationChannel, type ChannelAction } from "./channels";
import { generateNotifications } from "./generate";

describe("action tokens", () => {
  it("mints 24 random bytes as base64url, distinct each time, and a stable hash", () => {
    const a = mintActionToken();
    const b = mintActionToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashActionToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
  });

  it("parses only well-formed HW_DONE_ actions", () => {
    const { token } = mintActionToken();
    expect(parseDoneAction(`${ACTION_DONE_PREFIX}${token}`)).toBe(token);
    for (const bad of [
      token,
      "HW_DONE_",
      "hw_done_abc",
      "HW_OTHER_abc",
      "HW_DONE_a b",
      "HW_DONE_a/../b",
      `HW_DONE_${"a".repeat(65)}`,
      "",
      null,
      42,
      { action: "x" },
    ]) {
      expect(parseDoneAction(bad), String(bad)).toBeNull();
    }
  });
});

describe("performDoneAction", () => {
  const test = useTestDB();
  const ctx = (when = "2026-06-15", time = "07:00") =>
    ctxAt(test.db, at(when, time));
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));

  async function setup() {
    const anna = await createTestUser();
    const tokens: ChannelAction[] = [];
    stops.push(
      registerNotificationChannel({
        name: "test",
        deliver: (n, recipient, request) => {
          if (n.kind === "due") tokens.push(...request.actions);
          return [{ status: "sent", target: `phone-${recipient.id}` }];
        },
      }),
    );
    const task = await makeTask(ctx(), {
      title: "Filter",
      trigger: everyDays(30, "2026-06-15", "schedule"),
    });
    await generateNotifications(ctx());
    return { anna, task, action: `${ACTION_DONE_PREFIX}${tokens[0].id}` };
  }

  const completions = (taskId: string) =>
    test.db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId))
      .all();
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      if (err instanceof ApiError) return `${err.code}:${err.status}`;
      throw err;
    }
    return "none";
  };

  it("completes the occurrence for the person the notification went to, source notification", async () => {
    const { anna, task, action } = await setup();
    const result = await performDoneAction(ctx("2026-06-15", "08:00"), action);
    expect(result).toMatchObject({ taskId: task.id, replayed: false });
    const [done] = completions(task.id);
    expect(done).toMatchObject({
      id: result.completionId,
      userId: anna.id,
      source: "notification",
      kind: "done",
      occurrenceKey: "2026-06-15",
    });
    const delivery = test.db.select().from(notificationDeliveries).all()[0];
    expect(delivery.actionUsedAt?.getTime()).toBe(at("2026-06-15", "08:00"));
    expect(delivery.actionCompletionId).toBe(done.id);
  });

  it("tapping again answers with the first completion and writes nothing", async () => {
    const { task, action } = await setup();
    const first = await performDoneAction(ctx("2026-06-15", "08:00"), action);
    const again = await performDoneAction(ctx("2026-06-15", "08:05"), action);
    expect(again).toEqual({ ...first, replayed: true });
    expect(completions(task.id)).toHaveLength(1);
  });

  it("two taps at the same time write one completion", async () => {
    const { task, action } = await setup();
    const results = await Promise.all([
      performDoneAction(ctx("2026-06-15", "08:00"), action),
      performDoneAction(ctx("2026-06-15", "08:00"), action),
    ]);
    expect(new Set(results.map((r) => r.completionId)).size).toBe(1);
    expect(completions(task.id)).toHaveLength(1);
  });

  it("an unknown or malformed action is 404", async () => {
    await setup();
    expect(await codeOf(performDoneAction(ctx(), "HW_DONE_unknowntoken"))).toBe(
      "not_found:404",
    );
    expect(await codeOf(performDoneAction(ctx(), "SOMETHING_ELSE"))).toBe(
      "not_found:404",
    );
    expect(await codeOf(performDoneAction(ctx(), "HW_DONE_"))).toBe(
      "not_found:404",
    );
  });

  it("an expired token is 410, valid until the last moment", async () => {
    const { task, action } = await setup();
    const expiry = at("2026-06-15", "07:00") + ACTION_TOKEN_TTL_MS;
    expect(
      await codeOf(performDoneAction({ db: test.db, now: expiry }, action)),
    ).toBe("gone:410");
    expect(completions(task.id)).toEqual([]);
    const ok = await performDoneAction(
      { db: test.db, now: expiry - 1 },
      action,
    );
    expect(ok.replayed).toBe(false);
  });

  it("is 410 once the occurrence was settled another way", async () => {
    const { anna, task, action } = await setup();
    await completeTask(ctx("2026-06-15", "07:30"), task.id, {
      kind: "done",
      source: "manual",
      userId: anna.id,
    });
    expect(
      await codeOf(performDoneAction(ctx("2026-06-15", "08:00"), action)),
    ).toBe("gone:410");
    expect(completions(task.id)).toHaveLength(1);
  });

  it("is 410 for an archived task", async () => {
    const { task, action } = await setup();
    await updateTask(ctx(), task.id, { archived: true });
    expect(await codeOf(performDoneAction(ctx(), action))).toBe("gone:410");
  });

  it("is 410 after the completion it caused was undone", async () => {
    const { anna, action } = await setup();
    const first = await performDoneAction(ctx("2026-06-15", "08:00"), action);
    await undoCompletion(
      ctx("2026-06-15", "08:10"),
      first.completionId,
      anna.id,
    );
    expect(
      await codeOf(performDoneAction(ctx("2026-06-15", "08:20"), action)),
    ).toBe("gone:410");
  });

  it("is 410 when the task was deleted along with its notification", async () => {
    const { task, action } = await setup();
    deleteTask(ctx(), task.id);
    // the delivery went with the notification (cascade): the token is unknown now
    expect(await codeOf(performDoneAction(ctx(), action))).toBe(
      "not_found:404",
    );
  });
});
