import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Hint = {
  id: string;
  title: string;
  pinned: boolean;
  sortOrder: number;
  reaction: unknown;
  taskId: string | null;
};

describe("hints API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Geschirrspüler" } })
    ).body as { id: string };
    return { user, call, asset };
  }
  const reaction = {
    type: "signal_change",
    entityId: "sensor.example",
    toState: "done",
    fromState: "running",
    delayMinutes: 30,
    notify: "all",
  };

  it("creates, lists (pinned first), reads, updates and deletes", async () => {
    const { call, asset } = await setup();
    const make = (json: object) =>
      call("POST", `/api/v1/assets/${asset.id}/hints`, { json });
    const tip = (
      await make({
        title: "Einmal pro Woche mit 75 °C laufen lassen",
        bodyMd: "Spült Fett aus den Rohren.",
        kind: "tip",
      })
    ).body as Hint;
    const rule = (
      await make({
        title: "Nur Tabs verwenden",
        kind: "rule",
        pinned: true,
        guestVisible: true,
      })
    ).body as Hint;
    expect(tip).toMatchObject({
      kind: "tip",
      pinned: false,
      sortOrder: 0,
      reaction: null,
    });
    expect(rule).toMatchObject({
      kind: "rule",
      pinned: true,
      guestVisible: true,
      sortOrder: 1,
    });
    const list = (await call("GET", `/api/v1/assets/${asset.id}/hints`))
      .body as { items: Hint[] };
    expect(list.items.map((h) => h.title)).toEqual([
      "Nur Tabs verwenden",
      "Einmal pro Woche mit 75 °C laufen lassen",
    ]);
    expect((await call("GET", `/api/v1/hints/${tip.id}`)).body).toEqual(tip);
    const moved = await call("PATCH", `/api/v1/hints/${tip.id}`, {
      json: { pinned: true, sortOrder: 0 },
    });
    expect(moved.body).toMatchObject({ pinned: true, sortOrder: 0 });
    const again = (await call("GET", `/api/v1/assets/${asset.id}/hints`))
      .body as { items: Hint[] };
    expect(again.items.map((h) => h.id)).toEqual([tip.id, rule.id]);
    expect((await call("DELETE", `/api/v1/hints/${tip.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/hints/${tip.id}`))).toBe(
      "not_found",
    );
  });

  it("stores a signal reaction and lists reactive hints", async () => {
    const { call, asset } = await setup();
    const make = (json: object) =>
      call("POST", `/api/v1/assets/${asset.id}/hints`, { json });
    await make({ title: "plain" });
    const r = await make({ title: "reactive", reaction });
    expect(r.res.status).toBe(201);
    expect((r.body as Hint).reaction).toEqual(reaction);
    const reactive = (await call("GET", "/api/v1/hints?reactive=true"))
      .body as { items: (Hint & { assetName: string })[] };
    expect(reactive.items.map((h) => h.title)).toEqual(["reactive"]);
    expect(reactive.items[0].assetName).toBe("Geschirrspüler");
    expect(
      ((await call("GET", "/api/v1/hints")).body as { items: Hint[] }).items,
    ).toHaveLength(2);
    const cleared = await call(
      "PATCH",
      `/api/v1/hints/${(r.body as Hint).id}`,
      { json: { reaction: null } },
    );
    expect((cleared.body as Hint).reaction).toBeNull();
  });

  it("validates the reaction, the fields and the references", async () => {
    const { call, asset } = await setup();
    const make = (json: object) =>
      call("POST", `/api/v1/assets/${asset.id}/hints`, { json });
    for (const json of [
      {},
      { title: "" },
      { title: "x", kind: "joke" },
      { title: "x", reaction: { ...reaction, delayMinutes: 1441 } },
      { title: "x", reaction: { ...reaction, type: "other" } },
      { title: "x", reaction: { ...reaction, notify: [] } },
      { title: "x", reaction: { ...reaction, extra: true } },
      { title: "x", taskId: "nope" },
      { title: "x", reaction: { ...reaction, notify: ["nope"] } },
      { title: "x", sortOrder: -1 },
    ]) {
      const r = await make(json);
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    expect(
      errorCode(
        await call("PATCH", "/api/v1/hints/nope", { json: { title: "x" } }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("DELETE", "/api/v1/hints/nope"))).toBe(
      "not_found",
    );
    expect(errorCode(await call("GET", "/api/v1/assets/nope/hints"))).toBe(
      "not_found",
    );
    expect(
      errorCode(
        await call("POST", "/api/v1/assets/nope/hints", {
          json: { title: "x" },
        }),
      ),
    ).toBe("not_found");
    const h = (await make({ title: "ok" })).body as Hint;
    expect(
      errorCode(await call("PATCH", `/api/v1/hints/${h.id}`, { json: {} })),
    ).toBe("invalid_request");
  });

  it("links a task and keeps the hint when the task goes", async () => {
    const { call, asset } = await setup();
    const task = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Heiss spülen",
          assetId: asset.id,
          trigger: { v: 1, type: "one_off", date: "2099-01-01" },
        },
      })
    ).body as { id: string };
    const h = (
      await call("POST", `/api/v1/assets/${asset.id}/hints`, {
        json: { title: "t", taskId: task.id },
      })
    ).body as Hint & { taskTitle: string };
    expect(h).toMatchObject({ taskId: task.id, taskTitle: "Heiss spülen" });
    await call("DELETE", `/api/v1/tasks/${task.id}`);
    expect(
      ((await call("GET", `/api/v1/hints/${h.id}`)).body as Hint).taskId,
    ).toBeNull();
  });

  it("removes the hints with their asset", async () => {
    const { call, asset } = await setup();
    const h = (
      await call("POST", `/api/v1/assets/${asset.id}/hints`, {
        json: { title: "t" },
      })
    ).body as Hint;
    await call("DELETE", `/api/v1/assets/${asset.id}`);
    expect(errorCode(await call("GET", `/api/v1/hints/${h.id}`))).toBe(
      "not_found",
    );
  });

  it("can be commented on", async () => {
    const { call, asset } = await setup();
    const h = (
      await call("POST", `/api/v1/assets/${asset.id}/hints`, {
        json: { title: "t" },
      })
    ).body as Hint;
    const c = await call("POST", "/api/v1/comments", {
      json: {
        entityType: "asset_hint",
        entityId: h.id,
        bodyMd: "Gut zu wissen",
      },
    });
    expect(c.res.status).toBe(201);
    expect(
      (
        (await call("GET", `/api/v1/hints/${h.id}`)).body as {
          commentCount: number;
        }
      ).commentCount,
    ).toBe(1);
  });

  it("needs write scope to change and read scope to look", async () => {
    const { user, asset } = await setup();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect(
      (await reader("GET", `/api/v1/assets/${asset.id}/hints`)).res.status,
    ).toBe(200);
    expect(
      (
        await reader("POST", `/api/v1/assets/${asset.id}/hints`, {
          json: { title: "x" },
        })
      ).res.status,
    ).toBe(403);
  });
});
