import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Comment = {
  id: string;
  entityType: string;
  entityId: string;
  author: { id: string; displayName: string } | null;
  bodyMd: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
};
type Notification = {
  kind: string;
  titleKey: string;
  params: Record<string, string>;
  url: string | null;
  taskId: string | null;
};

const oneOff = { v: 1, type: "one_off", date: "2099-01-01" };

describe("comments API", () => {
  useTestDB();
  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const root = await createTestUser({ displayName: "Root", role: "admin" });
    const as = (u: { id: string }) =>
      createCaller({ session: loginTestUser(u as never).token });
    const callAnna = as(anna);
    const task = (
      await callAnna("POST", "/api/v1/tasks", {
        json: { title: "Filter wechseln", trigger: oneOff },
      })
    ).body as { id: string };
    return {
      anna,
      ben,
      root,
      callAnna,
      callBen: as(ben),
      callRoot: as(root),
      task,
    };
  }
  const post = (
    call: ReturnType<typeof createCaller>,
    entityType: string,
    entityId: string,
    bodyMd: string,
  ) =>
    call("POST", "/api/v1/comments", {
      json: { entityType, entityId, bodyMd },
    });
  const list = async (
    call: ReturnType<typeof createCaller>,
    entityType: string,
    entityId: string,
    qs = "",
  ) =>
    (
      await call(
        "GET",
        `/api/v1/comments?entityType=${entityType}&entityId=${entityId}${qs}`,
      )
    ).body as { items: Comment[]; nextCursor: string | null };

  it("adds a comment and returns it with its author and permissions", async () => {
    const { anna, callAnna, task } = await setup();
    const r = await post(callAnna, "task", task.id, "Neuer Filter bestellt");
    expect(r.res.status).toBe(201);
    expect(r.body).toMatchObject({
      entityType: "task",
      entityId: task.id,
      author: { id: anna.id, displayName: "Anna" },
      bodyMd: "Neuer Filter bestellt",
      editedAt: null,
      deleted: false,
      canEdit: true,
      canDelete: true,
    });
    expect((r.body as Comment).createdAt).toMatch(/Z$/);
  });

  it("lists oldest first with cursor pagination", async () => {
    const { callAnna, callBen, task } = await setup();
    for (const [call, text] of [
      [callAnna, "1"],
      [callBen, "2"],
      [callAnna, "3"],
    ] as const)
      await post(call, "task", task.id, text);
    expect(
      (await list(callAnna, "task", task.id)).items.map((c) => c.bodyMd),
    ).toEqual(["1", "2", "3"]);
    const first = await list(callAnna, "task", task.id, "&limit=2");
    expect(first.items.map((c) => c.bodyMd)).toEqual(["1", "2"]);
    const second = await list(
      callAnna,
      "task",
      task.id,
      `&limit=2&cursor=${first.nextCursor}`,
    );
    expect([second.items.map((c) => c.bodyMd), second.nextCursor]).toEqual([
      ["3"],
      null,
    ]);
  });

  it("tells each viewer what they may do", async () => {
    const { callAnna, callBen, callRoot, task } = await setup();
    await post(callAnna, "task", task.id, "von Anna");
    const flags = async (call: ReturnType<typeof createCaller>) => {
      const [c] = (await list(call, "task", task.id)).items;
      return [c.canEdit, c.canDelete];
    };
    expect(await flags(callAnna)).toEqual([true, true]);
    expect(await flags(callBen)).toEqual([false, false]);
    expect(await flags(callRoot)).toEqual([false, true]);
  });

  it("lets only the author edit and records the edit time", async () => {
    const { callAnna, callBen, callRoot, task } = await setup();
    const c = (await post(callAnna, "task", task.id, "alt")).body as Comment;
    const edited = await callAnna("PATCH", `/api/v1/comments/${c.id}`, {
      json: { bodyMd: "neu" },
    });
    expect(edited.body).toMatchObject({ bodyMd: "neu", canEdit: true });
    expect((edited.body as Comment).editedAt).toMatch(/Z$/);
    for (const other of [callBen, callRoot]) {
      const r = await other("PATCH", `/api/v1/comments/${c.id}`, {
        json: { bodyMd: "x" },
      });
      expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
    }
    expect((await list(callAnna, "task", task.id)).items[0].bodyMd).toBe("neu");
  });

  it("lets the author or an administrator delete, softly", async () => {
    const { callAnna, callBen, callRoot, task } = await setup();
    const own = (await post(callAnna, "task", task.id, "eins")).body as Comment;
    const other = (await post(callAnna, "task", task.id, "zwei"))
      .body as Comment;
    await post(callAnna, "task", task.id, "drei");
    const denied = await callBen("DELETE", `/api/v1/comments/${own.id}`);
    expect([denied.res.status, errorCode(denied)]).toEqual([403, "forbidden"]);
    expect(
      (await callAnna("DELETE", `/api/v1/comments/${own.id}`)).res.status,
    ).toBe(204);
    expect(
      (await callRoot("DELETE", `/api/v1/comments/${other.id}`)).res.status,
    ).toBe(204);
    expect(
      (await callRoot("DELETE", `/api/v1/comments/${other.id}`)).res.status,
    ).toBe(204);
    const { items } = await list(callAnna, "task", task.id);
    expect(
      items.map((c) => [c.bodyMd, c.deleted, c.canEdit, c.canDelete]),
    ).toEqual([
      ["", true, false, false],
      ["", true, false, false],
      ["drei", false, true, true],
    ]);
    const edit = await callAnna("PATCH", `/api/v1/comments/${own.id}`, {
      json: { bodyMd: "x" },
    });
    expect([edit.res.status, errorCode(edit)]).toEqual([409, "conflict"]);
  });

  it("answers 404 for unknown entities, comments and unregistered types", async () => {
    const { callAnna } = await setup();
    expect(errorCode(await post(callAnna, "task", "nope", "x"))).toBe(
      "not_found",
    );
    expect(errorCode(await post(callAnna, "defect", "nope", "x"))).toBe(
      "not_found",
    );
    expect(errorCode(await post(callAnna, "doc_page", "nope", "x"))).toBe(
      "not_found",
    );
    expect(
      errorCode(
        await callAnna(
          "GET",
          "/api/v1/comments?entityType=asset&entityId=nope",
        ),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await callAnna("PATCH", "/api/v1/comments/nope", {
          json: { bodyMd: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(errorCode(await callAnna("DELETE", "/api/v1/comments/nope"))).toBe(
      "not_found",
    );
  });

  it("validates input", async () => {
    const { callAnna, task } = await setup();
    for (const json of [
      {},
      { entityType: "task", entityId: task.id },
      { entityType: "task", entityId: task.id, bodyMd: "   " },
      { entityType: "task", entityId: task.id, bodyMd: "x".repeat(10_001) },
      { entityType: "planet", entityId: task.id, bodyMd: "x" },
      { entityType: "task", entityId: task.id, bodyMd: "x", userId: "someone" },
    ]) {
      const r = await callAnna("POST", "/api/v1/comments", { json });
      expect(
        [r.res.status, errorCode(r)],
        JSON.stringify(json).slice(0, 80),
      ).toEqual([400, "invalid_request"]);
    }
    expect(
      (await post(callAnna, "task", task.id, "x".repeat(10_000))).res.status,
    ).toBe(201);
    const c = (await post(callAnna, "task", task.id, "ok")).body as Comment;
    expect(
      errorCode(
        await callAnna("PATCH", `/api/v1/comments/${c.id}`, {
          json: { bodyMd: "" },
        }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await callAnna("PATCH", `/api/v1/comments/${c.id}`, { json: {} }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(await callAnna("GET", "/api/v1/comments?entityType=task")),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await callAnna(
          "GET",
          `/api/v1/comments?entityType=task&entityId=${task.id}&cursor=zzz`,
        ),
      ),
    ).toBe("invalid_request");
  });

  it("comments on every commentable entity", async () => {
    const { callAnna } = await setup();
    const make = async (path: string, json: object) =>
      ((await callAnna("POST", path, { json })).body as { id: string }).id;
    const room = await make("/api/v1/rooms", { name: "Küche" });
    const asset = await make("/api/v1/assets", { name: "Boiler" });
    const part = await make("/api/v1/parts", { name: "Filter" });
    const contact = await make("/api/v1/contacts", { name: "Muster AG" });
    const defect = await make("/api/v1/defects", { title: "Riss" });
    const log = await make(`/api/v1/assets/${asset}/service-log`, {
      title: "Service",
    });
    const hint = await make(`/api/v1/assets/${asset}/hints`, { title: "Tipp" });
    for (const [type, id] of [
      ["room", room],
      ["asset", asset],
      ["part", part],
      ["contact", contact],
      ["defect", defect],
      ["service_log", log],
      ["asset_hint", hint],
    ]) {
      expect((await post(callAnna, type, id, "Hallo")).res.status, type).toBe(
        201,
      );
      expect((await list(callAnna, type, id)).items, type).toHaveLength(1);
    }
  });

  it("counts comments on tasks, assets and defects, not counting deleted ones", async () => {
    const { callAnna, task } = await setup();
    const asset = (
      await callAnna("POST", "/api/v1/assets", { json: { name: "Boiler" } })
    ).body as { id: string };
    const defect = (
      await callAnna("POST", "/api/v1/defects", { json: { title: "Riss" } })
    ).body as { id: string };
    await post(callAnna, "task", task.id, "1");
    const gone = (await post(callAnna, "task", task.id, "2")).body as Comment;
    await callAnna("DELETE", `/api/v1/comments/${gone.id}`);
    await post(callAnna, "asset", asset.id, "1");
    await post(callAnna, "defect", defect.id, "1");
    expect(
      (
        (await callAnna("GET", `/api/v1/tasks/${task.id}`)).body as {
          commentCount: number;
        }
      ).commentCount,
    ).toBe(1);
    expect(
      (
        (await callAnna("GET", "/api/v1/tasks")).body as {
          items: { commentCount: number }[];
        }
      ).items[0].commentCount,
    ).toBe(1);
    expect(
      (
        (await callAnna("GET", `/api/v1/assets/${asset.id}`)).body as {
          commentCount: number;
        }
      ).commentCount,
    ).toBe(1);
    expect(
      (
        (await callAnna("GET", "/api/v1/assets")).body as {
          items: { commentCount: number }[];
        }
      ).items[0].commentCount,
    ).toBe(1);
    expect(
      (
        (await callAnna("GET", `/api/v1/defects/${defect.id}`)).body as {
          commentCount: number;
        }
      ).commentCount,
    ).toBe(1);
    expect(
      (
        (await callAnna("GET", "/api/v1/defects")).body as {
          items: { commentCount: number }[];
        }
      ).items[0].commentCount,
    ).toBe(1);
  });

  it("removes the comments with their entity", async () => {
    const { callAnna, task } = await setup();
    await post(callAnna, "task", task.id, "x");
    await callAnna("DELETE", `/api/v1/tasks/${task.id}`);
    expect(
      errorCode(
        await callAnna(
          "GET",
          `/api/v1/comments?entityType=task&entityId=${task.id}`,
        ),
      ),
    ).toBe("not_found");
    const { getDB, comments } = await import("$lib/server/db");
    expect(getDB().select().from(comments).all()).toEqual([]);
  });

  describe("notifications", () => {
    const notificationsOf = async (call: ReturnType<typeof createCaller>) =>
      (
        (await call("GET", "/api/v1/notifications")).body as {
          items: Notification[];
        }
      ).items;

    it("tell the others about a comment on a task", async () => {
      const { callAnna, callBen, callRoot, task } = await setup();
      await post(callBen, "task", task.id, "Bitte bis Freitag");
      expect(await notificationsOf(callBen)).toEqual([]);
      for (const call of [callAnna, callRoot]) {
        expect(await notificationsOf(call)).toEqual([
          expect.objectContaining({
            kind: "comment",
            titleKey: "notification_comment",
            params: { author: "Ben", title: "Filter wechseln" },
            url: `/tasks/${task.id}`,
            taskId: task.id,
          }),
        ]);
      }
    });

    it("go to the assignee of an assigned task only", async () => {
      const { ben, callAnna, callBen, callRoot } = await setup();
      const t = (
        await callAnna("POST", "/api/v1/tasks", {
          json: {
            title: "Zugewiesen",
            trigger: oneOff,
            assignMode: "fixed",
            assigneeUserId: ben.id,
          },
        })
      ).body as { id: string };
      await post(callAnna, "task", t.id, "Hi Ben");
      expect(await notificationsOf(callBen)).toHaveLength(1);
      expect(await notificationsOf(callRoot)).toEqual([]);
    });

    it("go to everyone else for a defect", async () => {
      const { callAnna, callBen, callRoot } = await setup();
      const d = (
        await callAnna("POST", "/api/v1/defects", {
          json: { title: "Riss in der Wand" },
        })
      ).body as { id: string };
      await post(callRoot, "defect", d.id, "Ich rufe an");
      expect((await notificationsOf(callAnna))[0]).toMatchObject({
        params: { author: "Root", title: "#1 Riss in der Wand" },
        url: `/defects/${d.id}`,
        taskId: null,
      });
      expect(await notificationsOf(callBen)).toHaveLength(1);
      expect(await notificationsOf(callRoot)).toEqual([]);
    });
  });

  it("needs read scope to look and write scope to change", async () => {
    const { anna, task } = await setup();
    const reader = createCaller({
      bearer: createTestToken(anna, { scopes: ["read"] }).token,
    });
    expect(
      (
        await reader(
          "GET",
          `/api/v1/comments?entityType=task&entityId=${task.id}`,
        )
      ).res.status,
    ).toBe(200);
    expect((await post(reader, "task", task.id, "x")).res.status).toBe(403);
    const writer = createCaller({
      bearer: createTestToken(anna, { scopes: ["read", "write"] }).token,
    });
    expect((await post(writer, "task", task.id, "x")).res.status).toBe(201);
  });
});
