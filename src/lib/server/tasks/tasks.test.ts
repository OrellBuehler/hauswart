import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import {
  taskCompletions,
  taskPreparations,
  taskState,
  tasks,
} from "$lib/server/db";
import { createAsset } from "$lib/server/assets/assets";
import { createRoom } from "$lib/server/rooms/rooms";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  at,
  ctxAt,
  everyDays,
  makeTask,
  NOW,
  taskInput,
  weekly,
} from "$lib/testing/domain";
import { completeTask } from "./completions";
import { createPreparation } from "./preparations";
import {
  deleteTask,
  getTask,
  listTasks,
  previewTrigger,
  updateTask,
} from "./tasks";

const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (err) {
    return (err as ApiError).code;
  }
  return null;
};

describe("tasks", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  it("creates a task and computes its first due state", async () => {
    const task = await makeTask(ctx(), {
      title: "Filter wechseln",
      category: "filter",
      trigger: everyDays(90, "2026-06-20"),
    });
    expect(task).toMatchObject({
      title: "Filter wechseln",
      category: "filter",
      priority: "normal",
      assignMode: "none",
      assigneeUserId: null,
      rotationOrder: [],
      graceDays: 0,
      source: "manual",
      archivedAt: null,
    });
    expect(task.state).toMatchObject({
      status: "open",
      dueDate: "2026-06-20",
      dueKind: "exact",
      occurrenceKey: "2026-06-20",
      currentAssigneeUserId: null,
    });
  });

  it("evaluates far-off tasks as ok and past ones as overdue", async () => {
    expect(
      (await makeTask(ctx(), { trigger: everyDays(30, "2026-09-01") })).state
        ?.status,
    ).toBe("ok");
    const late = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-01"),
    });
    expect(late.state?.status).toBe("overdue");
  });

  it("uses the task's own lead window, then the household's", async () => {
    const trigger = everyDays(30, "2026-06-25");
    expect((await makeTask(ctx(), { trigger })).state?.status).toBe("ok");
    expect(
      (await makeTask(ctx(), { trigger, dueSoonDays: 14 })).state?.status,
    ).toBe("open");
  });

  it("honours the grace period", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-12"),
      graceDays: 5,
    });
    expect(task.state?.status).toBe("due");
  });

  it("rejects unknown assets and rooms", async () => {
    expect(await codeOf(() => makeTask(ctx(), { assetId: "nope" }))).toBe(
      "invalid_request",
    );
    expect(await codeOf(() => makeTask(ctx(), { roomId: "nope" }))).toBe(
      "invalid_request",
    );
    expect(test.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("names the asset and room", async () => {
    const room = createRoom(ctx(), { name: "Küche" });
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Dampfabzug", roomId: room.id }),
    );
    const task = await makeTask(ctx(), { assetId: asset.id, roomId: room.id });
    expect(task).toMatchObject({ assetName: "Dampfabzug", roomName: "Küche" });
  });

  describe("assignment", () => {
    it("fixed needs an existing user", async () => {
      expect(await codeOf(() => makeTask(ctx(), { assignMode: "fixed" }))).toBe(
        "invalid_request",
      );
      expect(
        await codeOf(() =>
          makeTask(ctx(), { assignMode: "fixed", assigneeUserId: "ghost" }),
        ),
      ).toBe("invalid_request");
    });

    it("fixed assigns and clears the rotation", async () => {
      const anna = await createTestUser();
      const task = await makeTask(ctx(), {
        assignMode: "fixed",
        assigneeUserId: anna.id,
        rotationOrder: [anna.id],
      });
      expect(task).toMatchObject({
        assigneeUserId: anna.id,
        rotationOrder: [],
      });
      expect(task.state?.currentAssigneeUserId).toBe(anna.id);
    });

    it("rotate needs known users, de-duplicates and starts with the first", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      expect(
        await codeOf(() => makeTask(ctx(), { assignMode: "rotate" })),
      ).toBe("invalid_request");
      expect(
        await codeOf(() =>
          makeTask(ctx(), {
            assignMode: "rotate",
            rotationOrder: [anna.id, "ghost"],
          }),
        ),
      ).toBe("invalid_request");
      const task = await makeTask(ctx(), {
        assignMode: "rotate",
        rotationOrder: [ben.id, anna.id, ben.id],
        assigneeUserId: anna.id,
      });
      expect(task).toMatchObject({
        rotationOrder: [ben.id, anna.id],
        assigneeUserId: null,
      });
      expect(task.state?.currentAssigneeUserId).toBe(ben.id);
    });

    it("none clears stale assignees when the mode changes", async () => {
      const anna = await createTestUser();
      const task = await makeTask(ctx(), {
        assignMode: "fixed",
        assigneeUserId: anna.id,
      });
      const updated = await updateTask(ctx(), task.id, { assignMode: "none" });
      expect(updated).toMatchObject({
        assignMode: "none",
        assigneeUserId: null,
      });
      expect(updated.state?.currentAssigneeUserId).toBeNull();
    });

    it("switching to fixed in an update checks the merged result", async () => {
      const anna = await createTestUser();
      const task = await makeTask(ctx());
      expect(
        await codeOf(() => updateTask(ctx(), task.id, { assignMode: "fixed" })),
      ).toBe("invalid_request");
      const updated = await updateTask(ctx(), task.id, {
        assignMode: "fixed",
        assigneeUserId: anna.id,
      });
      expect(updated.state?.currentAssigneeUserId).toBe(anna.id);
    });
  });

  describe("external references", () => {
    it("are unique together and conflict otherwise", async () => {
      await makeTask(ctx(), { externalSource: "seed", externalRef: "putzen" });
      expect(
        await codeOf(() =>
          makeTask(ctx(), { externalSource: "seed", externalRef: "putzen" }),
        ),
      ).toBe("conflict");
      await makeTask(ctx(), { externalSource: "other", externalRef: "putzen" });
      await makeTask(ctx());
      await makeTask(ctx());
      expect(test.db.select().from(tasks).all()).toHaveLength(4);
    });
  });

  describe("update", () => {
    it("re-evaluates when the trigger changes", async () => {
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-06-20"),
      });
      const updated = await updateTask(ctx(), task.id, {
        trigger: everyDays(30, "2026-06-16"),
      });
      expect(updated.state).toMatchObject({
        dueDate: "2026-06-16",
        status: "open",
      });
      const grace = await updateTask(ctx(), task.id, { graceDays: 3 });
      expect(grace.graceDays).toBe(3);
    });

    it("clears nullable fields with null", async () => {
      const task = await makeTask(ctx(), { effortMinutes: 30, dueSoonDays: 3 });
      const updated = await updateTask(ctx(), task.id, {
        effortMinutes: null,
        dueSoonDays: null,
      });
      expect(updated).toMatchObject({ effortMinutes: null, dueSoonDays: null });
    });

    it("archives and restores, keeping the first archive time", async () => {
      const task = await makeTask(ctx());
      const archived = await updateTask(ctx(), task.id, { archived: true });
      expect(archived.archivedAt).toBeInstanceOf(Date);
      const later = await updateTask(
        { db: test.db, now: NOW + 10_000 },
        task.id,
        {
          archived: true,
        },
      );
      expect(later.archivedAt?.getTime()).toBe(archived.archivedAt?.getTime());
      expect(
        (await updateTask(ctx(), task.id, { archived: false })).archivedAt,
      ).toBeNull();
    });

    it("404s for unknown tasks and checks references", async () => {
      expect(
        await codeOf(() => updateTask(ctx(), "nope", { title: "x" })),
      ).toBe("not_found");
      const task = await makeTask(ctx());
      expect(
        await codeOf(() => updateTask(ctx(), task.id, { assetId: "nope" })),
      ).toBe("invalid_request");
    });
  });

  describe("list", () => {
    it("orders overdue first, then by due date, then title, and pages", async () => {
      await makeTask(ctx(), {
        title: "Spät",
        trigger: everyDays(30, "2026-08-01"),
      });
      await makeTask(ctx(), {
        title: "Bald",
        trigger: everyDays(30, "2026-06-18"),
      });
      await makeTask(ctx(), {
        title: "Überfällig",
        trigger: everyDays(30, "2026-06-01"),
      });
      await makeTask(ctx(), {
        title: "Heute",
        trigger: everyDays(30, "2026-06-15"),
      });
      const all = listTasks(ctx(), {}, { limit: 50 }, "u").items.map(
        (t) => t.title,
      );
      expect(all).toEqual(["Überfällig", "Heute", "Bald", "Spät"]);

      const first = listTasks(ctx(), {}, { limit: 3 }, "u");
      expect(first.items).toHaveLength(3);
      const second = listTasks(
        ctx(),
        {},
        { limit: 3, cursor: first.nextCursor as string },
        "u",
      );
      expect([...first.items, ...second.items].map((t) => t.title)).toEqual(
        all,
      );
      expect(second.nextCursor).toBeNull();
    });

    it("orders a task whose estimate comes before its hard limit by the estimate", async () => {
      await makeTask(ctx(), {
        title: "Mitte",
        trigger: everyDays(30, "2026-08-01"),
      });
      const counted = await makeTask(ctx(), {
        title: "Service",
        trigger: everyDays(30, "2026-09-01"),
      });
      test.db
        .update(taskState)
        .set({
          dueDate: "2027-03-01",
          dueKind: "estimated",
          estimateJson: { date: "2026-07-01", confidence: "medium" },
        })
        .where(eq(taskState.taskId, counted.id))
        .run();
      await makeTask(ctx(), {
        title: "Früh",
        trigger: everyDays(30, "2026-06-20"),
      });
      const all = listTasks(ctx(), {}, { limit: 50 }, "u").items.map(
        (t) => t.title,
      );
      expect(all).toEqual(["Früh", "Service", "Mitte"]);
    });

    it("filters by status, category, asset, room, text, archive and external ref", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Boiler" }),
      );
      await makeTask(ctx(), {
        title: "Boiler entkalken",
        category: "maintenance",
        assetId: asset.id,
        trigger: everyDays(30, "2026-06-01"),
      });
      await makeTask(ctx(), {
        title: "Bad putzen",
        category: "cleaning",
        roomId: room.id,
        descriptionMd: "mit Essig",
        trigger: everyDays(30, "2026-09-01"),
      });
      const old = await makeTask(ctx(), {
        title: "Altes",
        externalSource: "seed",
        externalRef: "alt",
      });
      await updateTask(ctx(), old.id, { archived: true });
      const titles = (filter: Parameters<typeof listTasks>[1]) =>
        listTasks(ctx(), filter, { limit: 50 }, "u").items.map((t) => t.title);

      expect(titles({})).toEqual(["Boiler entkalken", "Bad putzen"]);
      expect(titles({ includeArchived: true })).toHaveLength(3);
      expect(titles({ status: "overdue" })).toEqual(["Boiler entkalken"]);
      expect(titles({ status: "ok" })).toEqual(["Bad putzen"]);
      expect(titles({ category: "cleaning" })).toEqual(["Bad putzen"]);
      expect(titles({ assetId: asset.id })).toEqual(["Boiler entkalken"]);
      expect(titles({ roomId: room.id })).toEqual(["Bad putzen"]);
      expect(titles({ q: "essig" })).toEqual(["Bad putzen"]);
      expect(titles({ q: "BOILER" })).toEqual(["Boiler entkalken"]);
      expect(
        titles({
          externalSource: "seed",
          externalRef: "alt",
          includeArchived: true,
        }),
      ).toEqual(["Altes"]);
    });

    it("filters by current assignee, resolving me", async () => {
      const [anna, ben] = [await createTestUser(), await createTestUser()];
      await makeTask(ctx(), {
        title: "Annas",
        assignMode: "fixed",
        assigneeUserId: anna.id,
      });
      await makeTask(ctx(), {
        title: "Rotation",
        assignMode: "rotate",
        rotationOrder: [ben.id, anna.id],
      });
      await makeTask(ctx(), { title: "Niemandes" });
      const titles = (assignee: string, viewer: string) =>
        listTasks(ctx(), { assignee }, { limit: 50 }, viewer).items.map(
          (t) => t.title,
        );
      expect(titles("me", anna.id)).toEqual(["Annas"]);
      expect(titles("me", ben.id)).toEqual(["Rotation"]);
      expect(titles(anna.id, ben.id)).toEqual(["Annas"]);
    });
  });

  describe("preview", () => {
    it("evaluates a trigger as if never completed, storing nothing", () => {
      const result = previewTrigger(ctx(), everyDays(30, "2026-06-20"));
      expect(result).toMatchObject({
        status: "open",
        dueDate: "2026-06-20",
        reasons: ["never_completed"],
      });
      expect(test.db.select().from(tasks).all()).toHaveLength(0);
      expect(test.db.select().from(taskState).all()).toHaveLength(0);
    });

    it("can be evaluated as of another date and with another lead window", () => {
      const trigger = everyDays(30, "2026-06-20");
      expect(
        previewTrigger(ctx(), trigger, { today: "2026-06-30" }).status,
      ).toBe("overdue");
      expect(
        previewTrigger(ctx(), trigger, { today: "2026-06-01" }).status,
      ).toBe("ok");
      expect(
        previewTrigger(ctx(), trigger, { today: "2026-06-01", dueSoonDays: 30 })
          .status,
      ).toBe("open");
      expect(
        previewTrigger(ctx(), trigger, { today: "2026-06-21", graceDays: 2 })
          .status,
      ).toBe("due");
    });

    it("previews calendar triggers", () => {
      const result = previewTrigger(ctx(), weekly("2026-06-15", [3]));
      expect(result.dueDate).toBe("2026-06-17");
    });

    it("leaves signal-based triggers unknown", () => {
      const result = previewTrigger(ctx(), {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example",
        threshold: 100,
      });
      expect(result.status).toBe("unknown");
    });

    it("previews the time half of a counter with a time limit, counted from today", () => {
      const trigger = {
        v: 1,
        type: "counter_delta",
        entityId: "odometer:example",
        threshold: 15_000,
        unit: "km",
        orEvery: { every: 12, unit: "month" },
      } as const;
      const result = previewTrigger(ctx(), trigger);
      expect(result).toMatchObject({
        status: "ok",
        dueDate: "2027-06-15",
        dueKind: "exact",
        reasons: ["signal_missing"],
      });
      expect(
        previewTrigger(ctx(), trigger, { today: "2026-07-01" }).dueDate,
      ).toBe("2027-07-01");
    });
  });

  describe("delete", () => {
    it("removes the task with everything that hangs on it", async () => {
      const task = await makeTask(ctx());
      await createPreparation(ctx(), task.id, {
        title: "Vorbereiten",
        kind: "generic",
        qty: 1,
      });
      await completeTask(ctx(), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
      });
      deleteTask(ctx(), task.id);
      expect(test.db.select().from(tasks).all()).toHaveLength(0);
      expect(
        test.db
          .select()
          .from(taskState)
          .where(eq(taskState.taskId, task.id))
          .all(),
      ).toHaveLength(0);
      expect(test.db.select().from(taskCompletions).all()).toHaveLength(0);
      expect(test.db.select().from(taskPreparations).all()).toHaveLength(0);
      expect(await codeOf(() => getTask(ctx(), task.id))).toBe("not_found");
      expect(await codeOf(() => deleteTask(ctx(), task.id))).toBe("not_found");
    });
  });

  it("rejects stored triggers that no longer validate", async () => {
    const task = await makeTask(ctx());
    test.db
      .update(tasks)
      .set({ trigger: { type: "interval" } })
      .where(eq(tasks.id, task.id))
      .run();
    expect(() => getTask(ctx(), task.id)).toThrow(
      "Stored task trigger is invalid",
    );
  });

  it("stays valid across the whole task input surface", () => {
    expect(taskInput().graceDays).toBe(0);
    expect(at("2026-06-15")).toBe(NOW);
  });
});
