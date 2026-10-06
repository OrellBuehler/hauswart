import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
  type TestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";

type Json = Record<string, unknown>;
type TaskBody = {
  id: string;
  title: string;
  state: {
    status: string;
    dueDate: string | null;
    occurrenceKey: string;
    currentAssigneeUserId: string | null;
  } | null;
  snoozedUntil: string | null;
  archivedAt: string | null;
};

const interval = (startDate: string, every = 30) => ({
  v: 1,
  type: "interval",
  every,
  unit: "day",
  anchor: "completion",
  startDate,
});

describe("tasks API", () => {
  useTestDB();
  async function member(opts: { displayName?: string } = {}) {
    const user = await createTestUser(opts);
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }
  const create = (call: ReturnType<typeof createCaller>, json: Json) =>
    call("POST", "/api/v1/tasks", {
      json: { title: "Filter wechseln", trigger: interval(today(5)), ...json },
    });

  it("creates a task with its due state and reads it back with details", async () => {
    const { call } = await member();
    const created = await create(call, {
      category: "filter",
      priority: "high",
      effortMinutes: 20,
    });
    expect(created.res.status).toBe(201);
    const task = created.body as TaskBody;
    expect(created.body).toMatchObject({
      title: "Filter wechseln",
      category: "filter",
      priority: "high",
      effortMinutes: 20,
      assignMode: "none",
      source: "manual",
      state: { status: "open", dueDate: today(5), occurrenceKey: today(5) },
    });

    const got = await call("GET", `/api/v1/tasks/${task.id}`);
    expect(got.res.status).toBe(200);
    expect(got.body).toMatchObject({
      id: task.id,
      preparations: [],
      recentCompletions: [],
    });
  });

  it("rejects invalid triggers and bodies", async () => {
    const { call } = await member();
    for (const json of [
      { trigger: { v: 1, type: "interval" } },
      { trigger: { v: 1, type: "teleport" } },
      { trigger: { ...interval(today(1)), startDate: "2026-02-30" } },
      { title: "" },
      { category: "nope" },
      { unknown: true },
      { effortMinutes: 0 },
      { externalSource: "seed" },
    ]) {
      const r = await create(call, json);
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const noTrigger = await call("POST", "/api/v1/tasks", {
      json: { title: "x" },
    });
    expect(noTrigger.res.status).toBe(400);
  });

  it("checks references and assignment", async () => {
    const { call, user } = await member();
    for (const json of [
      { assetId: "nope" },
      { roomId: "nope" },
      { assignMode: "fixed" },
      { assignMode: "fixed", assigneeUserId: "ghost" },
      { assignMode: "rotate", rotationOrder: [] },
    ]) {
      const r = await create(call, json);
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const ok = await create(call, {
      assignMode: "fixed",
      assigneeUserId: user.id,
    });
    expect((ok.body as TaskBody).state?.currentAssigneeUserId).toBe(user.id);
  });

  it("conflicts on a duplicate external reference", async () => {
    const { call } = await member();
    const json = { externalSource: "seed", externalRef: "putzen" };
    expect((await create(call, json)).res.status).toBe(201);
    const dup = await create(call, json);
    expect([dup.res.status, errorCode(dup)]).toEqual([409, "conflict"]);
  });

  it("lists with filters and cursor", async () => {
    const { call, user } = await member();
    await create(call, {
      title: "Überfällig",
      trigger: interval(today(-3)),
      category: "cleaning",
    });
    await create(call, {
      title: "Bald",
      trigger: interval(today(2)),
      assignMode: "fixed",
      assigneeUserId: user.id,
    });
    await create(call, { title: "Später", trigger: interval(today(40)) });
    const titles = async (q = "") =>
      (
        (await call("GET", `/api/v1/tasks${q}`)).body as { items: TaskBody[] }
      ).items.map((t) => t.title);
    expect(await titles()).toEqual(["Überfällig", "Bald", "Später"]);
    expect(await titles("?status=overdue")).toEqual(["Überfällig"]);
    expect(await titles("?category=cleaning")).toEqual(["Überfällig"]);
    expect(await titles("?assignee=me")).toEqual(["Bald"]);
    expect(await titles(`?assignee=${user.id}`)).toEqual(["Bald"]);
    expect(await titles("?q=spät")).toEqual(["Später"]);
    const page = (await call("GET", "/api/v1/tasks?limit=2")).body as {
      items: TaskBody[];
      nextCursor: string;
    };
    expect(page.items).toHaveLength(2);
    const rest = (
      await call("GET", `/api/v1/tasks?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: TaskBody[]; nextCursor: null };
    expect(rest.items.map((t) => t.title)).toEqual(["Später"]);
    expect((await call("GET", "/api/v1/tasks?status=weird")).res.status).toBe(
      400,
    );
  });

  it("updates a task, re-evaluating its due state, and archives it", async () => {
    const { call } = await member();
    const task = (await create(call, {})).body as TaskBody;
    const updated = await call("PATCH", `/api/v1/tasks/${task.id}`, {
      json: {
        title: "Neuer Titel",
        trigger: interval(today(-1)),
        graceDays: 0,
      },
    });
    expect(updated.body).toMatchObject({
      title: "Neuer Titel",
      state: { status: "overdue", dueDate: today(-1) },
    });
    const archived = await call("PATCH", `/api/v1/tasks/${task.id}`, {
      json: { archived: true },
    });
    expect((archived.body as TaskBody).archivedAt).toMatch(/Z$/);
    expect(
      ((await call("GET", "/api/v1/tasks")).body as { items: unknown[] }).items,
    ).toHaveLength(0);
    expect(
      (
        (await call("GET", "/api/v1/tasks?includeArchived=true")).body as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
    const invalid = await call("PATCH", `/api/v1/tasks/${task.id}`, {
      json: {},
    });
    expect(invalid.res.status).toBe(400);
    expect(
      (
        await call("PATCH", `/api/v1/tasks/${task.id}`, {
          json: { status: "ok" },
        })
      ).res.status,
    ).toBe(400);
  });

  it("deletes a task", async () => {
    const { call } = await member();
    const task = (await create(call, {})).body as TaskBody;
    expect((await call("DELETE", `/api/v1/tasks/${task.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/tasks/${task.id}`))).toBe(
      "not_found",
    );
  });

  it("answers 404 for unknown tasks everywhere", async () => {
    const { call } = await member();
    for (const [method, path, json] of [
      ["GET", "/api/v1/tasks/nope", undefined],
      ["PATCH", "/api/v1/tasks/nope", { title: "x" }],
      ["DELETE", "/api/v1/tasks/nope", undefined],
      ["POST", "/api/v1/tasks/nope/complete", {}],
      ["POST", "/api/v1/tasks/nope/skip", {}],
      ["POST", "/api/v1/tasks/nope/snooze", { until: today(3) }],
    ] as const) {
      const r = await call(method, path, { json });
      expect([r.res.status, errorCode(r)], `${method} ${path}`).toEqual([
        404,
        "not_found",
      ]);
    }
  });

  describe("preview", () => {
    it("evaluates a trigger without storing anything", async () => {
      const { call } = await member();
      const r = await call("POST", "/api/v1/tasks/preview", {
        json: { trigger: interval(today(3)) },
      });
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        status: "open",
        dueDate: today(3),
        dueKind: "exact",
        reasons: ["never_completed"],
      });
      expect(
        ((await call("GET", "/api/v1/tasks")).body as { items: unknown[] })
          .items,
      ).toHaveLength(0);
    });

    it("takes a date, grace and lead window", async () => {
      const { call } = await member();
      const r = await call("POST", "/api/v1/tasks/preview", {
        json: {
          trigger: interval("2026-06-20"),
          today: "2026-06-21",
          graceDays: 2,
          dueSoonDays: 30,
        },
      });
      expect(r.body).toMatchObject({ status: "due", dueDate: "2026-06-20" });
    });

    it("validates the trigger", async () => {
      const { call } = await member();
      expect(
        (
          await call("POST", "/api/v1/tasks/preview", {
            json: { trigger: { v: 1, type: "nope" } },
          })
        ).res.status,
      ).toBe(400);
      expect(
        (await call("POST", "/api/v1/tasks/preview", { json: {} })).res.status,
      ).toBe(400);
    });

    it("works with read-only tokens", async () => {
      const user = await createTestUser();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"], kind: "mcp" }).token,
      });
      const r = await reader("POST", "/api/v1/tasks/preview", {
        json: { trigger: interval(today(3)) },
      });
      expect(r.res.status).toBe(200);
    });
  });

  describe("complete, skip and snooze", () => {
    it("completes: returns the completion and the re-evaluated task", async () => {
      const { call, user } = await member({ displayName: "Anna" });
      const task = (
        await create(call, { trigger: interval(today(-2)), title: "Putzen" })
      ).body as TaskBody;
      const r = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { note: "erledigt", counterValue: 12.5 },
      });
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        completion: {
          taskId: task.id,
          taskTitle: "Putzen",
          kind: "done",
          source: "manual",
          userId: user.id,
          userName: "Anna",
          note: "erledigt",
          counterValue: 12.5,
          completedDate: today(),
          occurrenceKey: today(-2),
          dueDateAtCompletion: today(-2),
          revokedAt: null,
        },
        task: { id: task.id, state: { status: "ok", dueDate: today(30) } },
      });
    });

    it("shows completions in the task detail and the global list", async () => {
      const { call } = await member();
      const task = (await create(call, {})).body as TaskBody;
      await call("POST", `/api/v1/tasks/${task.id}/complete`, { json: {} });
      const detail = (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
        recentCompletions: unknown[];
      };
      expect(detail.recentCompletions).toHaveLength(1);
      const list = (await call("GET", "/api/v1/completions")).body as {
        items: unknown[];
      };
      expect(list.items).toHaveLength(1);
    });

    it("attributes sessions as manual or qr, and ignores a token's claim", async () => {
      const { call, user } = await member();
      const task = (await create(call, {})).body as TaskBody;
      const source = async (
        c: ReturnType<typeof createCaller>,
        body: Json = {},
      ) =>
        (
          (await c("POST", `/api/v1/tasks/${task.id}/complete`, { json: body }))
            .body as { completion: { source: string } }
        ).completion.source;
      expect(await source(call)).toBe("manual");
      expect(await source(call, { source: "qr" })).toBe("qr");
      expect(await source(call, { source: "notification" })).toBe(
        "notification",
      );
      for (const [kind, expected] of [
        ["mcp", "mcp"],
        ["ha", "ha"],
        ["integration", "api"],
        ["mobile", "api"],
      ] as const) {
        const token = createTestToken(user, {
          kind,
          scopes: ["read", "write"],
        }).token;
        const tokenCall = createCaller({ bearer: token });
        expect(await source(tokenCall), kind).toBe(expected);
        expect(
          await source(tokenCall, { source: "qr" }),
          `${kind} claiming qr`,
        ).toBe(expected);
      }
    });

    it("rejects sources a client may not choose", async () => {
      const { call } = await member();
      const task = (await create(call, {})).body as TaskBody;
      for (const source of ["mcp", "ha", "system", "api", "kept"]) {
        const r = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
          json: { source },
        });
        expect(r.res.status, source).toBe(400);
      }
    });

    it("is idempotent by key: the replay answers 200 with the first completion", async () => {
      const { call } = await member();
      const task = (await create(call, {})).body as TaskBody;
      const first = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { idempotencyKey: "same-tap-aaaa" },
      });
      const second = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { idempotencyKey: "same-tap-aaaa", note: "x" },
      });
      expect([first.res.status, second.res.status]).toEqual([201, 200]);
      expect(
        (second.body as { completion: { id: string } }).completion.id,
      ).toBe((first.body as { completion: { id: string } }).completion.id);
      const list = (await call("GET", `/api/v1/completions?taskId=${task.id}`))
        .body as { items: unknown[] };
      expect(list.items).toHaveLength(1);
      const other = (await create(call, {})).body as TaskBody;
      const clash = await call("POST", `/api/v1/tasks/${other.id}/complete`, {
        json: { idempotencyKey: "same-tap-aaaa" },
      });
      expect([clash.res.status, errorCode(clash)]).toEqual([409, "conflict"]);
    });

    it("supports backdating but not the future", async () => {
      const { call } = await member();
      const task = (await create(call, { trigger: interval(today(-10)) }))
        .body as TaskBody;
      const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const r = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { completedAt: past },
      });
      expect(r.res.status).toBe(201);
      expect(
        (r.body as { completion: { completedAt: string } }).completion
          .completedAt,
      ).toBe(past);
      const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const bad = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { completedAt: future },
      });
      expect([bad.res.status, errorCode(bad)]).toEqual([
        400,
        "invalid_request",
      ]);
      expect(
        (
          await call("POST", `/api/v1/tasks/${task.id}/complete`, {
            json: { completedAt: "yesterday" },
          })
        ).res.status,
      ).toBe(400);
    });

    it("validates the body", async () => {
      const { call } = await member();
      const task = (await create(call, {})).body as TaskBody;
      for (const json of [
        { extra: 1 },
        { note: 5 },
        { idempotencyKey: "short" },
        { counterValue: "x" },
      ]) {
        expect(
          (await call("POST", `/api/v1/tasks/${task.id}/complete`, { json }))
            .res.status,
        ).toBe(400);
      }
      const noBody = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        rawBody: "",
      });
      expect(noBody.res.status).toBe(400);
    });

    it("skips an occurrence", async () => {
      const { call } = await member();
      const task = (await create(call, { trigger: interval(today(-1)) }))
        .body as TaskBody;
      const r = await call("POST", `/api/v1/tasks/${task.id}/skip`, {
        json: { note: "verreist" },
      });
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        completion: { kind: "skipped", note: "verreist" },
        task: { state: { status: "ok" } },
      });
      expect(
        (
          await call("POST", `/api/v1/tasks/${task.id}/skip`, {
            json: { counterValue: 3 },
          })
        ).res.status,
      ).toBe(400);
    });

    it("refuses to complete an archived task", async () => {
      const { call } = await member();
      const task = (await create(call, {})).body as TaskBody;
      await call("PATCH", `/api/v1/tasks/${task.id}`, {
        json: { archived: true },
      });
      const r = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: {},
      });
      expect([r.res.status, errorCode(r)]).toEqual([409, "conflict"]);
    });

    it("snoozes and ends the snooze", async () => {
      const { call } = await member();
      const task = (await create(call, { trigger: interval(today(2)) }))
        .body as TaskBody;
      const snoozed = await call("POST", `/api/v1/tasks/${task.id}/snooze`, {
        json: { until: today(10) },
      });
      expect(snoozed.body).toMatchObject({
        snoozedUntil: today(10),
        state: { status: "snoozed" },
      });
      const woken = await call("POST", `/api/v1/tasks/${task.id}/snooze`, {
        json: { until: null },
      });
      expect(woken.body).toMatchObject({
        snoozedUntil: null,
        state: { status: "open" },
      });
      for (const until of [today(), today(-1), "soon"]) {
        expect(
          (
            await call("POST", `/api/v1/tasks/${task.id}/snooze`, {
              json: { until },
            })
          ).res.status,
          until,
        ).toBe(400);
      }
      expect(
        (await call("POST", `/api/v1/tasks/${task.id}/snooze`, { json: {} }))
          .res.status,
      ).toBe(400);
    });
  });

  describe("rotation through the API", () => {
    it("hands the turn to the next person after each completion", async () => {
      const anna = await createTestUser();
      const ben = await createTestUser();
      const asAnna = createCaller({ session: loginTestUser(anna).token });
      const asBen = createCaller({ session: loginTestUser(ben).token });
      const task = (
        await create(asAnna, {
          trigger: interval(today(-1), 7),
          assignMode: "rotate",
          rotationOrder: [anna.id, ben.id],
        })
      ).body as TaskBody;
      expect(task.state?.currentAssigneeUserId).toBe(anna.id);
      const first = await asAnna("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: {},
      });
      expect(
        (first.body as { task: TaskBody }).task.state?.currentAssigneeUserId,
      ).toBe(ben.id);
      const second = await asBen("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: {},
      });
      expect(
        (second.body as { task: TaskBody }).task.state?.currentAssigneeUserId,
      ).toBe(anna.id);
    });
  });

  describe("access", () => {
    it("lets read tokens look but not change", async () => {
      const user: TestUser = await createTestUser();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"], kind: "mcp" }).token,
      });
      expect((await reader("GET", "/api/v1/tasks")).res.status).toBe(200);
      const denied = await reader("POST", "/api/v1/tasks", {
        json: { title: "x", trigger: interval(today(1)) },
      });
      expect([denied.res.status, errorCode(denied)]).toEqual([
        403,
        "forbidden",
      ]);
    });

    it("domain data is shared: another member sees and completes the same task", async () => {
      const { call } = await member();
      const other = await member();
      const task = (await create(call, {})).body as TaskBody;
      expect(
        (await other.call("GET", `/api/v1/tasks/${task.id}`)).res.status,
      ).toBe(200);
      expect(
        (
          await other.call("POST", `/api/v1/tasks/${task.id}/complete`, {
            json: {},
          })
        ).res.status,
      ).toBe(201);
    });
  });
});
