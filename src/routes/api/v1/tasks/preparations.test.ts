import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type Prep = {
  id: string;
  title: string;
  state: string;
  leadDays: number | null;
  sortOrder: number;
};

describe("preparations API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const task = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Filter wechseln",
          trigger: {
            v: 1,
            type: "interval",
            every: 30,
            unit: "day",
            anchor: "completion",
            startDate: today(5),
          },
        },
      })
    ).body as { id: string };
    return { call, task };
  }

  it("adds, lists, updates, ticks off and deletes preparations", async () => {
    const { call, task } = await setup();
    const created = await call(
      "POST",
      `/api/v1/tasks/${task.id}/preparations`,
      {
        json: { title: "Filter bestellen", leadDays: 14, qty: 2 },
      },
    );
    expect(created.res.status).toBe(201);
    const prep = created.body as Prep;
    expect(created.body).toMatchObject({
      taskId: task.id,
      title: "Filter bestellen",
      kind: "generic",
      leadDays: 14,
      leadValue: null,
      partId: null,
      qty: 2,
      state: "now",
    });

    const list = await call("GET", `/api/v1/tasks/${task.id}/preparations`);
    expect(list.body).toEqual({ items: [created.body], nextCursor: null });

    const patched = await call(
      "PATCH",
      `/api/v1/tasks/${task.id}/preparations/${prep.id}`,
      {
        json: { title: "Filter kaufen", leadDays: 3 },
      },
    );
    expect(patched.body).toMatchObject({
      title: "Filter kaufen",
      leadDays: 3,
      state: "not_yet",
    });

    const done = await call(
      "POST",
      `/api/v1/tasks/${task.id}/preparations/${prep.id}/complete`,
      { json: {} },
    );
    expect(done.res.status).toBe(200);
    expect(done.body).toMatchObject({ id: prep.id, state: "done" });
    const detail = (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
      preparations: Prep[];
    };
    expect(detail.preparations.map((p) => p.state)).toEqual(["done"]);

    expect(
      (await call("DELETE", `/api/v1/tasks/${task.id}/preparations/${prep.id}`))
        .res.status,
    ).toBe(204);
    expect(
      (
        (await call("GET", `/api/v1/tasks/${task.id}/preparations`)).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("is ticked off again for the next occurrence", async () => {
    const { call, task } = await setup();
    const prep = (
      await call("POST", `/api/v1/tasks/${task.id}/preparations`, {
        json: { title: "x", leadDays: 10 },
      })
    ).body as Prep;
    await call(
      "POST",
      `/api/v1/tasks/${task.id}/preparations/${prep.id}/complete`,
      { json: {} },
    );
    await call("POST", `/api/v1/tasks/${task.id}/complete`, { json: {} });
    const after = (await call("GET", `/api/v1/tasks/${task.id}/preparations`))
      .body as { items: Prep[] };
    expect(after.items[0].state).toBe("not_yet");
  });

  it("validates input", async () => {
    const { call, task } = await setup();
    for (const json of [
      {},
      { title: "" },
      { title: "x", kind: "nope" },
      { title: "x", leadDays: -1 },
      { title: "x", qty: 0 },
      {
        title: "x",
        leadValue: { entityId: "sensor.a", op: "approx", value: 1 },
      },
      { title: "x", extra: 1 },
    ]) {
      const r = await call("POST", `/api/v1/tasks/${task.id}/preparations`, {
        json,
      });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const prep = (
      await call("POST", `/api/v1/tasks/${task.id}/preparations`, {
        json: { title: "x" },
      })
    ).body as Prep;
    expect(
      (
        await call(
          "PATCH",
          `/api/v1/tasks/${task.id}/preparations/${prep.id}`,
          { json: {} },
        )
      ).res.status,
    ).toBe(400);
  });

  it("accepts a signal-based lead", async () => {
    const { call, task } = await setup();
    const r = await call("POST", `/api/v1/tasks/${task.id}/preparations`, {
      json: {
        title: "x",
        leadValue: { entityId: "sensor.filter", op: "lt", value: 20 },
      },
    });
    expect(r.body).toMatchObject({
      leadValue: { entityId: "sensor.filter", op: "lt", value: 20 },
      state: "not_yet",
    });
  });

  it("answers 404 for unknown tasks, preparations and mismatched pairs", async () => {
    const { call, task } = await setup();
    const other = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Anderes",
          trigger: { v: 1, type: "one_off", date: today(3) },
        },
      })
    ).body as { id: string };
    const prep = (
      await call("POST", `/api/v1/tasks/${task.id}/preparations`, {
        json: { title: "x" },
      })
    ).body as Prep;
    for (const [method, path, json] of [
      ["GET", "/api/v1/tasks/nope/preparations", undefined],
      ["POST", "/api/v1/tasks/nope/preparations", { title: "x" }],
      ["PATCH", `/api/v1/tasks/${task.id}/preparations/nope`, { title: "x" }],
      ["DELETE", `/api/v1/tasks/${task.id}/preparations/nope`, undefined],
      ["POST", `/api/v1/tasks/${task.id}/preparations/nope/complete`, {}],
      [
        "PATCH",
        `/api/v1/tasks/${other.id}/preparations/${prep.id}`,
        { title: "x" },
      ],
      [
        "DELETE",
        `/api/v1/tasks/${other.id}/preparations/${prep.id}`,
        undefined,
      ],
      [
        "POST",
        `/api/v1/tasks/${other.id}/preparations/${prep.id}/complete`,
        {},
      ],
    ] as const) {
      const r = await call(method, path, { json });
      expect([r.res.status, errorCode(r)], `${method} ${path}`).toEqual([
        404,
        "not_found",
      ]);
    }
  });
});
