import { describe, expect, it } from "vitest";
import {
  createAsset,
  deleteAsset,
  updateAsset,
} from "$lib/server/assets/assets";
import {
  createHintRequestSchema,
  signalReactionSchema,
  updateHintRequestSchema,
} from "$lib/api/schemas/hints";
import { createComment } from "$lib/server/comments/comments";
import { countCommentsOf } from "$lib/server/comments/comments";
import { deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, makeTask } from "$lib/testing/domain";
import {
  createHint,
  deleteHint,
  getHint,
  listAssetHints,
  listHints,
  updateHint,
} from "./hints";

describe("asset hints", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const page = { limit: 50 };
  const asset = (name = "Geschirrspüler") =>
    createAsset(ctx(), { kind: "device", name, showOnEmergency: false });
  const hint = (assetId: string, over: Record<string, unknown> = {}) =>
    createHint(
      ctx(),
      assetId,
      createHintRequestSchema.parse({ title: "Heiss laufen lassen", ...over }),
    );
  const reaction = {
    type: "signal_change" as const,
    entityId: "sensor.example_state",
    toState: "done",
    notify: "all" as const,
  };

  it("creates with defaults", () => {
    const a = asset();
    expect(hint(a.id, { bodyMd: "Einmal pro Woche mit 75 °C." })).toMatchObject(
      {
        assetId: a.id,
        assetName: "Geschirrspüler",
        title: "Heiss laufen lassen",
        bodyMd: "Einmal pro Woche mit 75 °C.",
        kind: "tip",
        pinned: false,
        sortOrder: 0,
        guestVisible: false,
        taskId: null,
        taskTitle: null,
        reaction: null,
        commentCount: 0,
      },
    );
  });

  it("appends new hints at the end unless a sort order is given", () => {
    const a = asset();
    expect(hint(a.id).sortOrder).toBe(0);
    expect(hint(a.id).sortOrder).toBe(1);
    expect(hint(a.id, { sortOrder: 10 }).sortOrder).toBe(10);
    expect(hint(a.id).sortOrder).toBe(11);
  });

  it("lists pinned hints first, then by sort order and creation", () => {
    const a = asset();
    hint(a.id, { title: "c", sortOrder: 2 });
    hint(a.id, { title: "a", sortOrder: 0 });
    hint(a.id, { title: "p2", pinned: true, sortOrder: 5 });
    hint(a.id, { title: "p1", pinned: true, sortOrder: 4 });
    hint(a.id, { title: "b", sortOrder: 0 });
    expect(listAssetHints(ctx(), a.id, page).items.map((h) => h.title)).toEqual(
      ["p1", "p2", "a", "b", "c"],
    );
  });

  it("reorders and pins through updates", () => {
    const a = asset();
    const first = hint(a.id, { title: "first" });
    hint(a.id, { title: "second" });
    updateHint(ctx(), first.id, { sortOrder: 5 });
    expect(listAssetHints(ctx(), a.id, page).items.map((h) => h.title)).toEqual(
      ["second", "first"],
    );
    updateHint(ctx(), first.id, { pinned: true });
    expect(listAssetHints(ctx(), a.id, page).items.map((h) => h.title)).toEqual(
      ["first", "second"],
    );
  });

  it("updates and clears the reaction and the task link", async () => {
    const a = asset();
    const task = await makeTask(ctx(), {
      title: "Heiss spülen",
      assetId: a.id,
    });
    const h = hint(a.id, { reaction, taskId: task.id });
    expect(h).toMatchObject({
      reaction,
      taskId: task.id,
      taskTitle: "Heiss spülen",
    });
    expect(
      updateHint(ctx(), h.id, { reaction: null, taskId: null }),
    ).toMatchObject({ reaction: null, taskId: null, taskTitle: null });
  });

  it("rejects an unknown task and unknown users to notify", () => {
    const a = asset();
    expect(() => hint(a.id, { taskId: "nope" })).toThrow(/Invalid request/);
    expect(() =>
      hint(a.id, { reaction: { ...reaction, notify: ["nope"] } }),
    ).toThrow(/Invalid request/);
    const h = hint(a.id);
    expect(() => updateHint(ctx(), h.id, { taskId: "nope" })).toThrow(
      /Invalid request/,
    );
  });

  it("accepts known users as recipients", async () => {
    const user = await createTestUser();
    const a = asset();
    expect(
      hint(a.id, { reaction: { ...reaction, notify: [user.id] } }).reaction
        ?.notify,
    ).toEqual([user.id]);
  });

  it("answers 404 for unknown assets and hints", () => {
    const a = asset();
    expect(() => hint("nope")).toThrow(/Asset not found/);
    expect(() => listAssetHints(ctx(), "nope", page)).toThrow(/not found/i);
    expect(() => getHint(ctx(), "nope")).toThrow(/not found/i);
    expect(() => updateHint(ctx(), "nope", { title: "x" })).toThrow(
      /not found/i,
    );
    expect(() => deleteHint(ctx(), "nope")).toThrow(/not found/i);
    expect(hint(a.id).id).toBeTruthy();
  });

  it("lists across assets, only reactive ones on request, and skips archived assets", () => {
    const a = asset("Alpha");
    const b = asset("Beta");
    const gone = asset("Gamma");
    hint(a.id, { title: "plain" });
    hint(b.id, { title: "reactive", reaction });
    hint(gone.id, { title: "archived", reaction });
    updateAsset(ctx(), gone.id, { archived: true });
    const titles = (f = {}) =>
      listHints(ctx(), f, page).items.map((h) => h.title);
    expect(titles()).toEqual(["plain", "reactive"]);
    expect(titles({ reactive: true })).toEqual(["reactive"]);
    expect(titles({ assetId: a.id })).toEqual(["plain"]);
    expect(titles({ kind: "warning" })).toEqual([]);
  });

  it("deleting a hint keeps its task; deleting the task keeps the hint; deleting the asset removes its hints and their comments", async () => {
    const user = await createTestUser();
    const a = asset();
    const task = await makeTask(ctx(), { assetId: a.id });
    const h = hint(a.id, { taskId: task.id });
    deleteTask(ctx(), task.id);
    expect(getHint(ctx(), h.id).taskId).toBeNull();
    await createComment(
      ctx(),
      { id: user.id, role: "member" },
      { entityType: "asset_hint", entityId: h.id, bodyMd: "Danke" },
    );
    expect(getHint(ctx(), h.id).commentCount).toBe(1);
    deleteAsset(ctx(), a.id);
    expect(listHints(ctx(), {}, page).items).toEqual([]);
    expect(countCommentsOf(ctx(), "asset_hint", h.id)).toBe(0);
  });
});

describe("signal reaction schema", () => {
  const base = {
    type: "signal_change",
    entityId: "x.y",
    toState: "on",
    notify: "all",
  };
  const ok = (v: unknown) => signalReactionSchema.safeParse(v).success;

  it("accepts the documented shapes", () => {
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, fromState: "off", delayMinutes: 0 })).toBe(true);
    expect(ok({ ...base, delayMinutes: 1440, notify: "assignee" })).toBe(true);
    expect(ok({ ...base, notify: ["u1", "u2"] })).toBe(true);
  });

  it("rejects bad types, delays, recipients and extra fields", () => {
    expect(ok({ ...base, type: "ha_state_change" })).toBe(false);
    expect(ok({ ...base, delayMinutes: 1441 })).toBe(false);
    expect(ok({ ...base, delayMinutes: -1 })).toBe(false);
    expect(ok({ ...base, delayMinutes: 1.5 })).toBe(false);
    expect(ok({ ...base, notify: [] })).toBe(false);
    expect(ok({ ...base, notify: "nobody" })).toBe(false);
    expect(ok({ ...base, entityId: "" })).toBe(false);
    expect(ok({ ...base, toState: undefined })).toBe(false);
    expect(ok({ ...base, extra: 1 })).toBe(false);
  });

  it("is validated inside hint requests", () => {
    expect(
      createHintRequestSchema.safeParse({
        title: "t",
        reaction: { ...base, delayMinutes: 5000 },
      }).success,
    ).toBe(false);
    expect(
      createHintRequestSchema.safeParse({ title: "t", kind: "nope" }).success,
    ).toBe(false);
    expect(createHintRequestSchema.safeParse({ title: "  " }).success).toBe(
      false,
    );
    expect(updateHintRequestSchema.safeParse({}).success).toBe(false);
    expect(updateHintRequestSchema.safeParse({ reaction: null }).success).toBe(
      true,
    );
  });
});
