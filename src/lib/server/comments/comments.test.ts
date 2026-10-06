import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createContact, deleteContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createDefect, deleteDefect } from "$lib/server/defects/defects";
import { createHint, deleteHint } from "$lib/server/hints/hints";
import { createPageRequestSchema } from "$lib/api/schemas/docs";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import {
  createPage,
  deletePage,
  getPage,
  listPages,
} from "$lib/server/docs/pages";
import { notifications } from "$lib/server/db";
import {
  registerNotificationChannel,
  type DeliverableNotification,
} from "$lib/server/notifications/channels";
import { createPart, deletePart } from "$lib/server/parts/parts";
import { createRoom, deleteRoom } from "$lib/server/rooms/rooms";
import { createEntry, deleteEntry } from "$lib/server/service-log/service-log";
import { createTask, deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, makeTask, taskInput } from "$lib/testing/domain";
import {
  allCommentsOf,
  countCommentsOf,
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type Viewer,
} from "./comments";
import { commentableOf, registerCommentable } from "./registry";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { createPartRequestSchema } from "$lib/api/schemas/parts";
import { createServiceLogRequestSchema } from "$lib/api/schemas/service-log";

afterEach(() => shutdownMarkdownWorkers());

describe("comments", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const viewerOf = (u: { id: string; role: "admin" | "member" }): Viewer => ({
    id: u.id,
    role: u.role,
  });
  const everyone = async () => ({
    anna: await createTestUser({ displayName: "Anna", username: "anna" }),
    ben: await createTestUser({ displayName: "Ben", username: "ben" }),
    root: await createTestUser({
      displayName: "Root",
      username: "root",
      role: "admin",
    }),
  });

  it("adds comments to a task, oldest first, with the author", async () => {
    const { anna, ben } = await everyone();
    const task = await makeTask(ctx());
    const target = { entityType: "task" as const, entityId: task.id };
    await createComment(ctx(at("2026-06-15", "09:00")), viewerOf(anna), {
      ...target,
      bodyMd: "Erster",
    });
    await createComment(ctx(at("2026-06-15", "10:00")), viewerOf(ben), {
      ...target,
      bodyMd: "Zweiter **fett**",
    });
    const { items } = listComments(ctx(), viewerOf(anna), target, page);
    expect(items.map((c) => c.bodyMd)).toEqual(["Erster", "Zweiter **fett**"]);
    expect(items[0]).toMatchObject({
      entityType: "task",
      entityId: task.id,
      author: { id: anna.id, displayName: "Anna" },
      editedAt: null,
      deleted: false,
    });
  });

  it("orders comments of the same instant by when they were written", async () => {
    const { anna } = await everyone();
    const task = await makeTask(ctx());
    const target = { entityType: "task" as const, entityId: task.id };
    for (const n of ["1", "2", "3"])
      await createComment(ctx(), viewerOf(anna), { ...target, bodyMd: n });
    expect(
      listComments(ctx(), viewerOf(anna), target, page).items.map(
        (c) => c.bodyMd,
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("pages with a cursor", async () => {
    const { anna } = await everyone();
    const task = await makeTask(ctx());
    const target = { entityType: "task" as const, entityId: task.id };
    for (const n of ["1", "2", "3"])
      await createComment(ctx(), viewerOf(anna), { ...target, bodyMd: n });
    const first = listComments(ctx(), viewerOf(anna), target, { limit: 2 });
    const second = listComments(ctx(), viewerOf(anna), target, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(first.items.map((c) => c.bodyMd)).toEqual(["1", "2"]);
    expect(second.items.map((c) => c.bodyMd)).toEqual(["3"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps threads of different entities apart", async () => {
    const { anna } = await everyone();
    const a = await makeTask(ctx());
    const b = await makeTask(ctx(), { title: "Anderes" });
    await createComment(ctx(), viewerOf(anna), {
      entityType: "task",
      entityId: a.id,
      bodyMd: "a",
    });
    expect(
      listComments(
        ctx(),
        viewerOf(anna),
        { entityType: "task", entityId: b.id },
        page,
      ).items,
    ).toEqual([]);
    expect(allCommentsOf(ctx(), viewerOf(anna), "task", a.id)).toHaveLength(1);
  });

  it("answers 404 for an unknown entity and for a type nobody registered", async () => {
    const { anna } = await everyone();
    await expect(
      createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: "nope",
        bodyMd: "x",
      }),
    ).rejects.toThrow(/not found/i);
    expect(() =>
      listComments(
        ctx(),
        viewerOf(anna),
        { entityType: "defect", entityId: "nope" },
        page,
      ),
    ).toThrow(/not found/i);
    const original = commentableOf("doc_page")!;
    registerCommentable("doc_page", original)();
    try {
      expect(commentableOf("doc_page")).toBeUndefined();
      await expect(
        createComment(ctx(), viewerOf(anna), {
          entityType: "doc_page",
          entityId: "x",
          bodyMd: "x",
        }),
      ).rejects.toThrow(/not found/i);
    } finally {
      registerCommentable("doc_page", original);
    }
  });

  it("lets a domain register its own entity type", async () => {
    const { anna } = await everyone();
    const original = commentableOf("doc_page")!;
    const off = registerCommentable("doc_page", {
      exists: (_db, id) => id === "page-1",
      title: () => "Handbuch",
      url: (_db, id) => `/docs/${id}`,
    });
    const comment = await createComment(ctx(), viewerOf(anna), {
      entityType: "doc_page",
      entityId: "page-1",
      bodyMd: "Hi",
    });
    expect(comment.entityType).toBe("doc_page");
    await expect(
      createComment(ctx(), viewerOf(anna), {
        entityType: "doc_page",
        entityId: "page-2",
        bodyMd: "x",
      }),
    ).rejects.toThrow(/not found/i);
    off();
    registerCommentable("doc_page", original);
  });

  describe("editing", () => {
    it("lets only the author edit, and records the edit time", async () => {
      const { anna, ben, root } = await everyone();
      const task = await makeTask(ctx());
      const c = await createComment(
        ctx(at("2026-06-15", "09:00")),
        viewerOf(anna),
        { entityType: "task", entityId: task.id, bodyMd: "alt" },
      );
      const edited = updateComment(
        ctx(at("2026-06-20", "09:00")),
        viewerOf(anna),
        c.id,
        "neu",
      );
      expect(edited).toMatchObject({
        bodyMd: "neu",
        editedAt: new Date(at("2026-06-20", "09:00")),
        canEdit: true,
      });
      expect(() => updateComment(ctx(), viewerOf(ben), c.id, "x")).toThrow(
        /author/,
      );
      expect(() => updateComment(ctx(), viewerOf(root), c.id, "x")).toThrow(
        /author/,
      );
      expect(() => updateComment(ctx(), viewerOf(anna), "nope", "x")).toThrow(
        /not found/i,
      );
    });

    it("tells the viewer what they may do", async () => {
      const { anna, ben, root } = await everyone();
      const task = await makeTask(ctx());
      const target = { entityType: "task" as const, entityId: task.id };
      await createComment(ctx(), viewerOf(anna), { ...target, bodyMd: "x" });
      const flags = (v: Viewer) => {
        const [c] = listComments(ctx(), v, target, page).items;
        return [c.canEdit, c.canDelete];
      };
      expect(flags(viewerOf(anna))).toEqual([true, true]);
      expect(flags(viewerOf(ben))).toEqual([false, false]);
      expect(flags(viewerOf(root))).toEqual([false, true]);
    });
  });

  describe("deleting", () => {
    it("soft-deletes: the thread keeps its place, the text is gone", async () => {
      const { anna } = await everyone();
      const task = await makeTask(ctx());
      const target = { entityType: "task" as const, entityId: task.id };
      await createComment(ctx(at("2026-06-15", "09:00")), viewerOf(anna), {
        ...target,
        bodyMd: "eins",
      });
      const second = await createComment(
        ctx(at("2026-06-15", "10:00")),
        viewerOf(anna),
        { ...target, bodyMd: "geheim" },
      );
      await createComment(ctx(at("2026-06-15", "11:00")), viewerOf(anna), {
        ...target,
        bodyMd: "drei",
      });
      deleteComment(ctx(), viewerOf(anna), second.id);
      const { items } = listComments(ctx(), viewerOf(anna), target, page);
      expect(items.map((c) => [c.bodyMd, c.deleted])).toEqual([
        ["eins", false],
        ["", true],
        ["drei", false],
      ]);
      expect(items[1]).toMatchObject({ canEdit: false, canDelete: false });
    });

    it("lets the author and administrators delete, nobody else", async () => {
      const { anna, ben, root } = await everyone();
      const task = await makeTask(ctx());
      const target = { entityType: "task" as const, entityId: task.id };
      const c1 = await createComment(ctx(), viewerOf(anna), {
        ...target,
        bodyMd: "1",
      });
      const c2 = await createComment(ctx(), viewerOf(anna), {
        ...target,
        bodyMd: "2",
      });
      expect(() => deleteComment(ctx(), viewerOf(ben), c1.id)).toThrow(
        /author/,
      );
      deleteComment(ctx(), viewerOf(anna), c1.id);
      deleteComment(ctx(), viewerOf(root), c2.id);
      expect(
        listComments(ctx(), viewerOf(anna), target, page).items.every(
          (c) => c.deleted,
        ),
      ).toBe(true);
      expect(() => deleteComment(ctx(), viewerOf(anna), "nope")).toThrow(
        /not found/i,
      );
    });

    it("deleting twice is fine, editing a deleted comment is a conflict", async () => {
      const { anna } = await everyone();
      const task = await makeTask(ctx());
      const c = await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      deleteComment(ctx(), viewerOf(anna), c.id);
      deleteComment(ctx(), viewerOf(anna), c.id);
      expect(() => updateComment(ctx(), viewerOf(anna), c.id, "y")).toThrow(
        /deleted/,
      );
    });

    it("an author whose account is gone shows as unknown and only admins may delete", async () => {
      const { anna, root } = await everyone();
      const task = await makeTask(ctx());
      const c = await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      const { users } = await import("$lib/server/db");
      test.db.delete(users).where(eq(users.id, anna.id)).run();
      const [item] = listComments(
        ctx(),
        viewerOf(root),
        { entityType: "task", entityId: task.id },
        page,
      ).items;
      expect(item).toMatchObject({
        id: c.id,
        author: null,
        canEdit: false,
        canDelete: true,
      });
    });
  });

  describe("cleanup when the entity is deleted", () => {
    const comment = async (
      entityType: Parameters<typeof createComment>[2]["entityType"],
      entityId: string,
    ) => {
      const user = await createTestUser();
      await createComment(ctx(), viewerOf(user), {
        entityType,
        entityId,
        bodyMd: "Hallo",
      });
      const dead = await createComment(ctx(), viewerOf(user), {
        entityType,
        entityId,
        bodyMd: "weg",
      });
      deleteComment(ctx(), viewerOf(user), dead.id);
      expect(countCommentsOf(ctx(), entityType, entityId)).toBe(2);
    };

    it("task", async () => {
      const task = await makeTask(ctx());
      await comment("task", task.id);
      deleteTask(ctx(), task.id);
      expect(countCommentsOf(ctx(), "task", task.id)).toBe(0);
    });

    it("defect", async () => {
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({ title: "Riss" }),
        null,
      );
      await comment("defect", defect.id);
      deleteDefect(ctx(), defect.id);
      expect(countCommentsOf(ctx(), "defect", defect.id)).toBe(0);
    });

    it("asset, with the comments of its service log and hints", async () => {
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const log = createEntry(
        ctx(),
        asset.id,
        createServiceLogRequestSchema.parse({ title: "Service" }),
        null,
      );
      const hint = createHint(
        ctx(),
        asset.id,
        createHintRequestSchema.parse({ title: "Tipp" }),
      );
      await comment("asset", asset.id);
      await comment("service_log", log.id);
      await comment("asset_hint", hint.id);
      deleteAsset(ctx(), asset.id);
      expect(countCommentsOf(ctx(), "asset", asset.id)).toBe(0);
      expect(countCommentsOf(ctx(), "service_log", log.id)).toBe(0);
      expect(countCommentsOf(ctx(), "asset_hint", hint.id)).toBe(0);
    });

    it("service log entry and hint on their own", async () => {
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const log = createEntry(
        ctx(),
        asset.id,
        createServiceLogRequestSchema.parse({ title: "Service" }),
        null,
      );
      const hint = createHint(
        ctx(),
        asset.id,
        createHintRequestSchema.parse({ title: "Tipp" }),
      );
      await comment("service_log", log.id);
      await comment("asset_hint", hint.id);
      deleteEntry(ctx(), asset.id, log.id);
      deleteHint(ctx(), hint.id);
      expect(countCommentsOf(ctx(), "service_log", log.id)).toBe(0);
      expect(countCommentsOf(ctx(), "asset_hint", hint.id)).toBe(0);
    });

    it("room, part and contact", async () => {
      const room = createRoom(ctx(), { name: "Küche" });
      const part = createPart(
        ctx(),
        createPartRequestSchema.parse({ name: "Filter" }),
        null,
      );
      const contact = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Muster AG" }),
      );
      await comment("room", room.id);
      await comment("part", part.id);
      await comment("contact", contact.id);
      deleteRoom(ctx(), room.id);
      deletePart(ctx(), part.id);
      deleteContact(ctx(), contact.id);
      expect(countCommentsOf(ctx(), "room", room.id)).toBe(0);
      expect(countCommentsOf(ctx(), "part", part.id)).toBe(0);
      expect(countCommentsOf(ctx(), "contact", contact.id)).toBe(0);
    });

    it("doc page", async () => {
      const user = await createTestUser();
      const doc = await createPage(
        ctx(),
        createPageRequestSchema.parse({ title: "Handbuch" }),
        user.id,
      );
      await comment("doc_page", doc.id);
      deletePage(ctx(), doc.slug);
      expect(countCommentsOf(ctx(), "doc_page", doc.id)).toBe(0);
    });

    it("leaves other entities' comments alone", async () => {
      const a = await makeTask(ctx());
      const b = await makeTask(ctx(), { title: "Anderes" });
      await comment("task", a.id);
      await comment("task", b.id);
      deleteTask(ctx(), a.id);
      expect(countCommentsOf(ctx(), "task", b.id)).toBe(2);
    });
  });

  describe("comment counts", () => {
    it("count the comments of a documentation page", async () => {
      const { anna } = await everyone();
      const doc = await createPage(
        ctx(),
        createPageRequestSchema.parse({ title: "Handbuch" }),
        anna.id,
      );
      expect(doc.commentCount).toBe(0);
      await createComment(ctx(), viewerOf(anna), {
        entityType: "doc_page",
        entityId: doc.id,
        bodyMd: "Hallo",
      });
      expect(getPage(ctx(), doc.slug).commentCount).toBe(1);
      expect(
        listPages(ctx(), {}, { limit: 50 }).items.map((p) => p.commentCount),
      ).toEqual([1]);
    });

    it("count only comments that are not deleted, on tasks, assets and defects", async () => {
      const { anna } = await everyone();
      const task = await makeTask(ctx());
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({ title: "Riss" }),
        null,
      );
      await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "1",
      });
      const gone = await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "2",
      });
      deleteComment(ctx(), viewerOf(anna), gone.id);
      await createComment(ctx(), viewerOf(anna), {
        entityType: "asset",
        entityId: asset.id,
        bodyMd: "1",
      });
      await createComment(ctx(), viewerOf(anna), {
        entityType: "defect",
        entityId: defect.id,
        bodyMd: "1",
      });
      const { getTask, listTasks } = await import("$lib/server/tasks/tasks");
      const { getAsset, listAssets } =
        await import("$lib/server/assets/assets");
      const { getDefect, listDefects } =
        await import("$lib/server/defects/defects");
      expect(getTask(ctx(), task.id).commentCount).toBe(1);
      expect(listTasks(ctx(), {}, page, anna.id).items[0].commentCount).toBe(1);
      expect(getAsset(ctx(), asset.id).commentCount).toBe(1);
      expect(listAssets(ctx(), {}, page).items[0].commentCount).toBe(1);
      expect(getDefect(ctx(), defect.id).commentCount).toBe(1);
      expect(listDefects(ctx(), {}, page).items[0].commentCount).toBe(1);
    });
  });

  describe("notifications", () => {
    const rows = () => test.db.select().from(notifications).all();

    it("tell everyone but the author about a comment on an asset", async () => {
      const { anna, ben, root } = await everyone();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const c = await createComment(ctx(), viewerOf(anna), {
        entityType: "asset",
        entityId: asset.id,
        bodyMd: "Hallo",
      });
      expect(
        rows()
          .map((r) => r.userId)
          .sort(),
      ).toEqual([ben.id, root.id].sort());
      expect(rows()[0]).toMatchObject({
        kind: "comment",
        titleKey: "notification_comment",
        paramsJson: { author: "Anna", title: "Boiler" },
        url: `/assets/${asset.id}`,
        taskId: null,
        readAt: null,
        dedupeKey: expect.stringContaining(`comment:${c.id}:`),
      });
    });

    it("send a comment on a documentation page to its docs route", async () => {
      const { anna, ben } = await everyone();
      const doc = await createPage(
        ctx(),
        createPageRequestSchema.parse({ title: "Heizung entlüften" }),
        anna.id,
      );
      await createComment(ctx(), viewerOf(anna), {
        entityType: "doc_page",
        entityId: doc.id,
        bodyMd: "Danke",
      });
      expect(rows().find((r) => r.userId === ben.id)).toMatchObject({
        url: `/docs/${doc.slug}`,
        paramsJson: { author: "Anna", title: "Heizung entlüften" },
      });
    });

    it("go to the fixed assignee of a task only", async () => {
      const { anna, ben } = await everyone();
      const task = await createTask(
        ctx(),
        taskInput({
          title: "Filter",
          assignMode: "fixed",
          assigneeUserId: ben.id,
        }),
        null,
      );
      await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      expect(rows().map((r) => r.userId)).toEqual([ben.id]);
      expect(rows()[0]).toMatchObject({
        taskId: task.id,
        url: `/tasks/${task.id}`,
        paramsJson: { author: "Anna", title: "Filter" },
      });
    });

    it("go to the rotation members of a task except the author", async () => {
      const { anna, ben, root } = await everyone();
      const task = await createTask(
        ctx(),
        taskInput({ assignMode: "rotate", rotationOrder: [anna.id, ben.id] }),
        null,
      );
      await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      expect(rows().map((r) => r.userId)).toEqual([ben.id]);
      expect(rows().some((r) => r.userId === root.id)).toBe(false);
    });

    it("go to everyone else for an unassigned task", async () => {
      const { anna, ben, root } = await everyone();
      const task = await makeTask(ctx());
      await createComment(ctx(), viewerOf(ben), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      expect(
        rows()
          .map((r) => r.userId)
          .sort(),
      ).toEqual([anna.id, root.id].sort());
    });

    it("are not sent when the author is the only one involved", async () => {
      const { anna } = await everyone();
      const task = await createTask(
        ctx(),
        taskInput({ assignMode: "fixed", assigneeUserId: anna.id }),
        null,
      );
      await createComment(ctx(), viewerOf(anna), {
        entityType: "task",
        entityId: task.id,
        bodyMd: "x",
      });
      expect(rows()).toEqual([]);
    });

    it("go to everyone else for a defect, with its number in the title", async () => {
      const { anna, ben, root } = await everyone();
      const defect = await createDefect(
        ctx(),
        createDefectRequestSchema.parse({ title: "Riss in der Wand" }),
        null,
      );
      await createComment(ctx(), viewerOf(root), {
        entityType: "defect",
        entityId: defect.id,
        bodyMd: "x",
      });
      expect(
        rows()
          .map((r) => r.userId)
          .sort(),
      ).toEqual([anna.id, ben.id].sort());
      expect(rows()[0]).toMatchObject({
        url: `/defects/${defect.id}`,
        paramsJson: { author: "Root", title: "#1 Riss in der Wand" },
      });
    });

    it("every comment notifies on its own; edits and deletes stay silent", async () => {
      const { anna } = await everyone();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      const target = { entityType: "asset" as const, entityId: asset.id };
      const c = await createComment(ctx(), viewerOf(anna), {
        ...target,
        bodyMd: "1",
      });
      await createComment(ctx(), viewerOf(anna), { ...target, bodyMd: "2" });
      expect(rows()).toHaveLength(4);
      updateComment(ctx(), viewerOf(anna), c.id, "1b");
      deleteComment(ctx(), viewerOf(anna), c.id);
      expect(rows()).toHaveLength(4);
    });

    it("hand each notification to the outward channels", async () => {
      const { anna, ben } = await everyone();
      const seen: [DeliverableNotification, string[]][] = [];
      const off = registerNotificationChannel({
        name: "test",
        deliver: (n, recipient) => {
          seen.push([n, [recipient.id]]);
          return [];
        },
      });
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      await createComment(ctx(), viewerOf(anna), {
        entityType: "asset",
        entityId: asset.id,
        bodyMd: "x",
      });
      off();
      expect(
        seen.some(([n, ids]) => n.kind === "comment" && ids[0] === ben.id),
      ).toBe(true);
    });

    it("do not hide the comment from a thread when nobody else exists", async () => {
      const only = await createTestUser();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Boiler",
        showOnEmergency: false,
      });
      await createComment(ctx(), viewerOf(only), {
        entityType: "asset",
        entityId: asset.id,
        bodyMd: "x",
      });
      expect(rows()).toEqual([]);
    });
  });
});
