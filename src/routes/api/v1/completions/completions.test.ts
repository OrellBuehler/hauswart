import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { taskCompletions } from "$lib/server/db";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type Completion = {
  id: string;
  taskId: string;
  userId: string | null;
  revokedAt: string | null;
};

describe("completions API", () => {
  const test = useTestDB();
  async function member() {
    const user = await createTestUser();
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }
  const makeTask = async (
    call: ReturnType<typeof createCaller>,
    startDate = today(-1),
  ) =>
    (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Putzen",
          trigger: {
            v: 1,
            type: "interval",
            every: 30,
            unit: "day",
            anchor: "completion",
            startDate,
          },
        },
      })
    ).body as { id: string };

  it("lists recent completions with who, newest first, filtered and paged", async () => {
    const { call, user } = await member();
    const other = await member();
    const [t1, t2] = [await makeTask(call), await makeTask(call)];
    const day = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString();
    await call("POST", `/api/v1/tasks/${t1.id}/complete`, {
      json: { completedAt: day(3) },
    });
    await other.call("POST", `/api/v1/tasks/${t2.id}/complete`, {
      json: { completedAt: day(2) },
    });
    await call("POST", `/api/v1/tasks/${t1.id}/complete`, {
      json: { completedAt: day(1) },
    });

    const all = (await call("GET", "/api/v1/completions")).body as {
      items: Completion[];
      nextCursor: null;
    };
    expect(all.items.map((c) => c.taskId)).toEqual([t1.id, t2.id, t1.id]);
    expect(all.nextCursor).toBeNull();
    const byTask = (await call("GET", `/api/v1/completions?taskId=${t1.id}`))
      .body as { items: Completion[] };
    expect(byTask.items).toHaveLength(2);
    const byUser = (
      await call("GET", `/api/v1/completions?userId=${other.user.id}`)
    ).body as { items: Completion[] };
    expect(byUser.items.map((c) => c.userId)).toEqual([other.user.id]);
    expect(user.id).not.toBe(other.user.id);

    const page = (await call("GET", "/api/v1/completions?limit=2")).body as {
      items: Completion[];
      nextCursor: string;
    };
    expect(page.items).toHaveLength(2);
    const rest = (
      await call("GET", `/api/v1/completions?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: Completion[]; nextCursor: null };
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("validates the query", async () => {
    const { call } = await member();
    expect(
      (await call("GET", "/api/v1/completions?limit=1000")).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/completions?cursor=garbage")).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/completions?includeRevoked=2")).res.status,
    ).toBe(400);
  });

  it("undoes a completion, restoring the previous due date, for any member", async () => {
    const { call } = await member();
    const other = await member();
    const task = await makeTask(call, today(-3));
    const done = (
      await call("POST", `/api/v1/tasks/${task.id}/complete`, { json: {} })
    ).body as { completion: Completion };
    expect(
      (
        (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
          state: { dueDate: string };
        }
      ).state.dueDate,
    ).toBe(today(30));

    const undone = await other.call(
      "DELETE",
      `/api/v1/completions/${done.completion.id}`,
    );
    expect(undone.res.status).toBe(204);
    expect(
      (
        (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
          state: { dueDate: string; status: string };
        }
      ).state,
    ).toMatchObject({
      dueDate: today(-3),
      status: "overdue",
    });
    expect(
      ((await call("GET", "/api/v1/completions")).body as { items: unknown[] })
        .items,
    ).toHaveLength(0);
    const revoked = (
      await call("GET", "/api/v1/completions?includeRevoked=true")
    ).body as { items: Completion[] };
    expect(revoked.items[0].revokedAt).toMatch(/Z$/);
    expect(
      (await call("DELETE", `/api/v1/completions/${done.completion.id}`)).res
        .status,
    ).toBe(204);
  });

  it("refuses to undo after the 7 day window", async () => {
    const { call } = await member();
    const task = await makeTask(call);
    const done = (
      await call("POST", `/api/v1/tasks/${task.id}/complete`, { json: {} })
    ).body as { completion: Completion };
    test.db
      .update(taskCompletions)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(taskCompletions.id, done.completion.id))
      .run();
    const r = await call("DELETE", `/api/v1/completions/${done.completion.id}`);
    expect([r.res.status, errorCode(r)]).toEqual([409, "conflict"]);
  });

  it("answers 404 for an unknown completion", async () => {
    const { call } = await member();
    const r = await call("DELETE", "/api/v1/completions/nope");
    expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
  });
});
