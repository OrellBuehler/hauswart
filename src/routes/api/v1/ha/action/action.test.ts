import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDB, notificationDeliveries, taskCompletions } from "$lib/server/db";
import { registerNotificationChannel } from "$lib/server/notifications/channels";
import { generateNotifications } from "$lib/server/notifications/generate";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";
import { ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import type { Scope } from "$lib/api/scopes";

const URL = "/api/v1/ha/action";

describe("POST /api/v1/ha/action", () => {
  const test = useTestDB();
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));

  async function setup() {
    const [anna, ben] = [
      await createTestUser({ displayName: "Anna" }),
      await createTestUser({ displayName: "Ben" }),
    ];
    const sent = new Map<string, string>();
    stops.push(
      registerNotificationChannel({
        name: "test",
        deliver: (n, recipient, request) => {
          if (n.kind === "due") sent.set(recipient.id, request.actions[0].id);
          return [{ status: "sent", target: "phone" }];
        },
      }),
    );
    // Real time: the route stamps requests with Date.now(), so the notification is created now too.
    const now = Date.now();
    const task = await makeTask(ctxAt(test.db, now), {
      title: "Filter",
      trigger: everyDays(30, today(), "schedule"),
    });
    await generateNotifications(ctxAt(test.db, now));
    const haToken = (
      user = anna,
      scopes: readonly Scope[] = ["ha:action"],
      kind: "ha" | "mobile" | "mcp" = "ha",
    ) =>
      createCaller({ bearer: createTestToken(user, { scopes, kind }).token });
    return {
      anna,
      ben,
      task,
      sent,
      haToken,
      action: (u: { id: string }) => `HW_DONE_${sent.get(u.id)}`,
    };
  }

  const completions = (taskId: string) =>
    test.db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId))
      .all();

  it("completes the task for the person the notification went to, not the token's owner", async () => {
    const { anna, ben, task, haToken, action } = await setup();
    // the HA token belongs to Ben, the tapped notification was Anna's
    const r = await haToken(ben)("POST", URL, {
      json: { action: action(anna) },
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({ taskId: task.id, replayed: false });
    const [done] = completions(task.id);
    expect(done).toMatchObject({
      userId: anna.id,
      source: "notification",
      kind: "done",
    });
    expect((r.body as { completionId: string }).completionId).toBe(done.id);
  });

  it("a second tap is 200 with the first completion", async () => {
    const { anna, task, haToken, action } = await setup();
    const call = haToken();
    const first = await call("POST", URL, { json: { action: action(anna) } });
    const second = await call("POST", URL, { json: { action: action(anna) } });
    expect(second.res.status).toBe(200);
    expect(second.body).toEqual({ ...(first.body as object), replayed: true });
    expect(completions(task.id)).toHaveLength(1);
  });

  it("each person's token completes once; the other's still works", async () => {
    const { anna, ben, task, haToken, action } = await setup();
    const call = haToken();
    expect(
      (await call("POST", URL, { json: { action: action(anna) } })).res.status,
    ).toBe(200);
    // Ben's notification belongs to the same occurrence, which Anna's tap settled
    const late = await call("POST", URL, { json: { action: action(ben) } });
    expect([late.res.status, errorCode(late)]).toEqual([410, "gone"]);
    expect(completions(task.id)).toHaveLength(1);
  });

  it("an unknown or foreign action is 404", async () => {
    await setup();
    const call = createCaller({
      bearer: createTestToken(await createTestUser(), {
        scopes: ["ha:action"],
        kind: "ha",
      }).token,
    });
    for (const action of ["HW_DONE_nonexistent", "OTHER_ACTION", "HW_DONE_"]) {
      const r = await call("POST", URL, { json: { action } });
      expect([r.res.status, errorCode(r)], action).toEqual([404, "not_found"]);
    }
  });

  it("an expired token is 410 gone", async () => {
    const { anna, task, haToken, action } = await setup();
    getDB()
      .update(notificationDeliveries)
      .set({ actionExpiresAt: new Date(Date.now() - 1000) })
      .run();
    const r = await haToken()("POST", URL, { json: { action: action(anna) } });
    expect([r.res.status, errorCode(r)]).toEqual([410, "gone"]);
    expect(completions(task.id)).toEqual([]);
  });

  it("needs the ha:action scope", async () => {
    const { anna, task, haToken, action } = await setup();
    const r = await haToken(anna, ["read", "write"])("POST", URL, {
      json: { action: action(anna) },
    });
    expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
    expect(completions(task.id)).toEqual([]);
  });

  it("needs a token of kind ha, even with the scope", async () => {
    const { anna, task, haToken, action } = await setup();
    for (const kind of ["mobile", "mcp"] as const) {
      const r = await haToken(anna, ["ha:action"], kind)("POST", URL, {
        json: { action: action(anna) },
      });
      expect([r.res.status, errorCode(r)], kind).toEqual([403, "forbidden"]);
    }
    expect(completions(task.id)).toEqual([]);
  });

  it("is not available to a browser session", async () => {
    const { anna, action } = await setup();
    const call = createCaller({ session: loginTestUser(anna).token });
    const r = await call("POST", URL, { json: { action: action(anna) } });
    expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
  });

  it("validates the body", async () => {
    const { haToken } = await setup();
    const call = haToken();
    for (const json of [
      {},
      { action: "" },
      { action: 5 },
      { action: "HW_DONE_x", extra: 1 },
    ]) {
      const r = await call("POST", URL, { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
  });
});
