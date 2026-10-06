import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPartRequestSchema } from "$lib/api/schemas/parts";
import { partMovements, parts, taskPreparations } from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { createAsset } from "$lib/server/assets/assets";
import { createPreparation } from "$lib/server/tasks/preparations";
import { listPreparations } from "$lib/server/tasks/preparations";
import { completeTask, undoCompletion } from "$lib/server/tasks/completions";
import { deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import {
  linkAssetPart,
  linkTaskPart,
  listAssetParts,
  listTaskParts,
  unlinkAssetPart,
  unlinkTaskPart,
  updateTaskPart,
} from "./links";
import { listOrderNow } from "./order-now";
import {
  bookStock,
  createPart,
  deletePart,
  getPart,
  getPartDetail,
  listMovements,
  listParts,
  markOrdered,
  updatePart,
} from "./parts";

describe("parts", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const make = (
    over: Record<string, unknown> = {},
    userId: string | null = null,
  ) =>
    createPart(
      ctx(),
      createPartRequestSchema.parse({ name: "Filterpatrone", ...over }),
      userId,
    );
  const page = { limit: 50 };

  describe("crud", () => {
    it("creates with defaults and the household currency", () => {
      updateHousehold(ctx(), { currency: "EUR" });
      const part = make();
      expect(part).toMatchObject({
        name: "Filterpatrone",
        currency: "EUR",
        stockCount: 0,
        minStock: 0,
        reorderQty: 1,
        leadTimeDays: 14,
        orderedAt: null,
        orderedQty: 0,
        lowStock: false,
        archivedAt: null,
      });
    });

    it("books a starting stock as a correction movement", async () => {
      const user = await createTestUser();
      const part = make({ stockCount: 3 }, user.id);
      const { items } = listMovements(ctx(), part.id, page);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        delta: 3,
        reason: "correction",
        userId: user.id,
      });
    });

    it("writes no movement for an empty starting stock", () => {
      const part = make();
      expect(listMovements(ctx(), part.id, page).items).toEqual([]);
    });

    it("updates fields, clears optional ones and archives", () => {
      const part = make({ supplier: "Muster AG", unitPriceMinor: 1990 });
      const updated = updatePart(ctx(), part.id, {
        supplier: null,
        unitPriceMinor: 2490,
        minStock: 2,
      });
      expect(updated).toMatchObject({
        supplier: null,
        unitPriceMinor: 2490,
        minStock: 2,
        lowStock: true,
      });
      const archived = updatePart(ctx(), part.id, { archived: true });
      expect(archived.archivedAt).toEqual(new Date(NOW));
      expect(
        updatePart(ctx(), part.id, { archived: false }).archivedAt,
      ).toBeNull();
    });

    it("answers 404 for unknown parts", () => {
      expect(() => getPart(ctx(), "nope")).toThrow(/not found/i);
      expect(() => updatePart(ctx(), "nope", { name: "x" })).toThrow(
        /not found/i,
      );
      expect(() => deletePart(ctx(), "nope")).toThrow(/not found/i);
      expect(() => markOrdered(ctx(), "nope", 1)).toThrow(/not found/i);
    });

    it("lists by name, searches, filters and leaves archived parts out", async () => {
      const b = make({ name: "Bürste", partNumber: "X-1" });
      const a = make({ name: "Dichtung", supplier: "Muster AG", minStock: 2 });
      const old = make({ name: "Alt" });
      updatePart(ctx(), old.id, { archived: true });
      const names = (f = {}) =>
        listParts(ctx(), f, page).items.map((p) => p.name);
      expect(names()).toEqual(["Bürste", "Dichtung"]);
      expect(names({ includeArchived: true })).toEqual([
        "Alt",
        "Bürste",
        "Dichtung",
      ]);
      expect(names({ q: "muster" })).toEqual(["Dichtung"]);
      expect(names({ q: "x-1" })).toEqual(["Bürste"]);
      expect(names({ lowStock: true })).toEqual(["Dichtung"]);
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Mixer",
        showOnEmergency: false,
      });
      linkAssetPart(ctx(), asset.id, a.id);
      expect(names({ assetId: asset.id })).toEqual(["Dichtung"]);
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, b.id, 1);
      expect(names({ taskId: task.id })).toEqual(["Bürste"]);
    });

    it("paginates", () => {
      for (const n of ["A", "B", "C"]) make({ name: n });
      const first = listParts(ctx(), {}, { limit: 2 });
      expect(first.items.map((p) => p.name)).toEqual(["A", "B"]);
      const second = listParts(
        ctx(),
        {},
        { limit: 2, cursor: first.nextCursor! },
      );
      expect(second.items.map((p) => p.name)).toEqual(["C"]);
      expect(second.nextCursor).toBeNull();
    });

    it("deleting removes links and movements and unlinks preparations", async () => {
      const part = make({ stockCount: 2 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      const prep = await createPreparation(ctx(), task.id, {
        title: "Bestellen",
        kind: "order_part",
        partId: part.id,
        qty: 1,
      });
      deletePart(ctx(), part.id);
      expect(test.db.select().from(parts).all()).toEqual([]);
      expect(test.db.select().from(partMovements).all()).toEqual([]);
      expect(listTaskParts(ctx(), task.id, page).items).toEqual([]);
      const row = test.db
        .select()
        .from(taskPreparations)
        .where(eq(taskPreparations.id, prep.id))
        .get();
      expect(row?.partId).toBeNull();
    });

    it("detail lists linked assets, active tasks and recent movements", async () => {
      const part = make({ stockCount: 4 });
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Mixer",
        showOnEmergency: false,
      });
      linkAssetPart(ctx(), asset.id, part.id);
      const task = await makeTask(ctx(), { title: "Wechseln" });
      linkTaskPart(ctx(), task.id, part.id, 2);
      const detail = getPartDetail(ctx(), part.id);
      expect(detail.assets).toEqual([{ id: asset.id, name: "Mixer" }]);
      expect(detail.tasks).toEqual([
        { id: task.id, title: "Wechseln", qty: 2 },
      ]);
      expect(detail.recentMovements).toHaveLength(1);
    });
  });

  describe("stock", () => {
    it("books used, bought and corrections and keeps the history", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const part = make({ stockCount: 5 });
      bookStock(ctx(at("2026-06-15", "13:00")), part.id, {
        delta: -2,
        reason: "used",
        userId: user.id,
        note: "Küche",
      });
      bookStock(ctx(at("2026-06-15", "14:00")), part.id, {
        delta: 10,
        reason: "bought",
        userId: user.id,
      });
      const final = bookStock(ctx(at("2026-06-15", "15:00")), part.id, {
        delta: -1,
        reason: "correction",
        userId: null,
      });
      expect(final.stockCount).toBe(12);
      const { items } = listMovements(ctx(), part.id, page);
      expect(items.map((m) => [m.reason, m.delta])).toEqual([
        ["correction", -1],
        ["bought", 10],
        ["used", -2],
        ["correction", 5],
      ]);
      expect(items[2]).toMatchObject({ userName: "Anna", note: "Küche" });
    });

    it("refuses to go below zero and leaves the stock alone", () => {
      const part = make({ stockCount: 1 });
      expect(() =>
        bookStock(ctx(), part.id, { delta: -2, reason: "used", userId: null }),
      ).toThrow(/Invalid request/);
      expect(getPart(ctx(), part.id).stockCount).toBe(1);
      expect(listMovements(ctx(), part.id, page).items).toHaveLength(1);
    });

    it("pages the movements newest first", () => {
      const part = make();
      for (let i = 1; i <= 3; i++) {
        bookStock(ctx(at("2026-06-15", `0${i}:00`)), part.id, {
          delta: i,
          reason: "bought",
          userId: null,
        });
      }
      const first = listMovements(ctx(), part.id, { limit: 2 });
      expect(first.items.map((m) => m.delta)).toEqual([3, 2]);
      const second = listMovements(ctx(), part.id, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((m) => m.delta)).toEqual([1]);
    });

    it("reports low stock below the minimum only", () => {
      const part = make({ stockCount: 2, minStock: 2 });
      expect(part.lowStock).toBe(false);
      expect(
        bookStock(ctx(), part.id, { delta: -1, reason: "used", userId: null })
          .lowStock,
      ).toBe(true);
    });
  });

  describe("ordering", () => {
    it("marks an order with the reorder quantity by default and clears it with 0", () => {
      const part = make({ reorderQty: 4 });
      const ordered = markOrdered(ctx(), part.id, undefined);
      expect(ordered).toMatchObject({
        orderedQty: 4,
        orderedAt: new Date(NOW),
      });
      expect(markOrdered(ctx(), part.id, 6).orderedQty).toBe(6);
      expect(markOrdered(ctx(), part.id, 0)).toMatchObject({
        orderedQty: 0,
        orderedAt: null,
      });
    });

    it("a bought movement clears the pending order, other movements do not", () => {
      const part = make({ stockCount: 2 });
      markOrdered(ctx(), part.id, 3);
      expect(
        bookStock(ctx(), part.id, { delta: -1, reason: "used", userId: null })
          .orderedQty,
      ).toBe(3);
      expect(
        bookStock(ctx(), part.id, { delta: 3, reason: "bought", userId: null }),
      ).toMatchObject({
        orderedQty: 0,
        orderedAt: null,
      });
    });
  });

  describe("links", () => {
    it("links parts to assets once and unlinks them", () => {
      const part = make();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Mixer",
        showOnEmergency: false,
      });
      expect(linkAssetPart(ctx(), asset.id, part.id)).toMatchObject({
        assetId: asset.id,
        partId: part.id,
      });
      expect(() => linkAssetPart(ctx(), asset.id, part.id)).toThrow(
        /already linked/,
      );
      expect(listAssetParts(ctx(), asset.id, page).items).toHaveLength(1);
      unlinkAssetPart(ctx(), asset.id, part.id);
      expect(listAssetParts(ctx(), asset.id, page).items).toEqual([]);
      expect(() => unlinkAssetPart(ctx(), asset.id, part.id)).toThrow(
        /not found/i,
      );
    });

    it("answers 404 for unknown assets, tasks and parts", async () => {
      const part = make();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Mixer",
        showOnEmergency: false,
      });
      const task = await makeTask(ctx());
      expect(() => linkAssetPart(ctx(), "nope", part.id)).toThrow(
        /Asset not found/,
      );
      expect(() => linkAssetPart(ctx(), asset.id, "nope")).toThrow(
        /Part not found/,
      );
      expect(() => linkTaskPart(ctx(), "nope", part.id, 1)).toThrow(
        /Task not found/,
      );
      expect(() => linkTaskPart(ctx(), task.id, "nope", 1)).toThrow(
        /Part not found/,
      );
      expect(() => listAssetParts(ctx(), "nope", page)).toThrow(/not found/i);
      expect(() => listTaskParts(ctx(), "nope", page)).toThrow(/not found/i);
    });

    it("links parts to tasks with a quantity, changes and removes it", async () => {
      const part = make();
      const task = await makeTask(ctx());
      expect(linkTaskPart(ctx(), task.id, part.id, 2).qty).toBe(2);
      expect(() => linkTaskPart(ctx(), task.id, part.id, 1)).toThrow(
        /already linked/,
      );
      expect(updateTaskPart(ctx(), task.id, part.id, 3).qty).toBe(3);
      expect(listTaskParts(ctx(), task.id, page).items[0]).toMatchObject({
        qty: 3,
        partId: part.id,
      });
      unlinkTaskPart(ctx(), task.id, part.id);
      expect(() => updateTaskPart(ctx(), task.id, part.id, 1)).toThrow(
        /not found/i,
      );
      expect(() => unlinkTaskPart(ctx(), task.id, part.id)).toThrow(
        /not found/i,
      );
    });

    it("deleting the asset or task removes the links", async () => {
      const part = make();
      const asset = createAsset(ctx(), {
        kind: "device",
        name: "Mixer",
        showOnEmergency: false,
      });
      linkAssetPart(ctx(), asset.id, part.id);
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      deleteTask(ctx(), task.id);
      expect(getPartDetail(ctx(), part.id).tasks).toEqual([]);
      const { deleteAsset } = await import("$lib/server/assets/assets");
      deleteAsset(ctx(), asset.id);
      expect(getPartDetail(ctx(), part.id).assets).toEqual([]);
    });
  });

  describe("completing and undoing tasks", () => {
    const complete = (
      taskId: string,
      userId: string | null = null,
      kind: "done" | "skipped" = "done",
    ) => completeTask(ctx(), taskId, { kind, source: "manual", userId });

    it("takes the linked quantity out of stock and books a used movement", async () => {
      const user = await createTestUser();
      const part = make({ stockCount: 5 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 2);
      const { completion } = await complete(task.id, user.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(3);
      const [movement] = listMovements(ctx(), part.id, page).items;
      expect(movement).toMatchObject({
        delta: -2,
        reason: "used",
        userId: user.id,
        completionId: completion.id,
      });
    });

    it("handles several parts and ignores tasks without parts", async () => {
      const a = make({ name: "A", stockCount: 3 });
      const b = make({ name: "B", stockCount: 1 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, a.id, 1);
      linkTaskPart(ctx(), task.id, b.id, 1);
      await complete(task.id);
      expect([
        getPart(ctx(), a.id).stockCount,
        getPart(ctx(), b.id).stockCount,
      ]).toEqual([2, 0]);
      const plain = await makeTask(ctx(), { title: "Ohne Teile" });
      await complete(plain.id);
      expect(
        test.db
          .select()
          .from(partMovements)
          .all()
          .filter((m) => m.delta < 0),
      ).toHaveLength(2);
    });

    it("skipping uses nothing", async () => {
      const part = make({ stockCount: 2 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      await complete(task.id, null, "skipped");
      expect(getPart(ctx(), part.id).stockCount).toBe(2);
    });

    it("stops at zero and records what was actually taken", async () => {
      const part = make({ stockCount: 1 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 3);
      await complete(task.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(0);
      expect(listMovements(ctx(), part.id, page).items[0].delta).toBe(-1);
    });

    it("writes nothing when the shelf is already empty", async () => {
      const part = make();
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      await complete(task.id);
      expect(listMovements(ctx(), part.id, page).items).toEqual([]);
    });

    it("undoing the completion puts back exactly what was taken", async () => {
      const user = await createTestUser();
      const part = make({ stockCount: 1 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 3);
      const { completion } = await complete(task.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(0);
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(1);
      const [undo, used] = listMovements(ctx(), part.id, page).items;
      expect(undo).toMatchObject({
        delta: 1,
        reason: "correction",
        userId: user.id,
        completionId: completion.id,
      });
      expect(used).toMatchObject({ delta: -1, reason: "used" });
    });

    it("undoing twice reverts once", async () => {
      const user = await createTestUser();
      const part = make({ stockCount: 4 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 2);
      const { completion } = await complete(task.id);
      await undoCompletion(ctx(), completion.id, user.id);
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(4);
    });

    it("undoing a skip changes no stock", async () => {
      const user = await createTestUser();
      const part = make({ stockCount: 4 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 2);
      const { completion } = await complete(task.id, null, "skipped");
      await undoCompletion(ctx(), completion.id, user.id);
      expect(getPart(ctx(), part.id).stockCount).toBe(4);
    });

    it("an idempotent replay books the stock once", async () => {
      const part = make({ stockCount: 4 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      const input = {
        kind: "done" as const,
        source: "manual" as const,
        userId: null,
        idempotencyKey: "retry-key-1",
      };
      await completeTask(ctx(), task.id, input);
      await completeTask(ctx(), task.id, input);
      expect(getPart(ctx(), part.id).stockCount).toBe(3);
    });

    it("rolls the completion back when the reaction fails", async () => {
      const part = make({ stockCount: 4 });
      const task = await makeTask(ctx());
      linkTaskPart(ctx(), task.id, part.id, 1);
      const { onEvent } = await import("$lib/server/events");
      const off = onEvent("completionRecorded", () => {
        throw new Error("boom");
      });
      await expect(complete(task.id)).rejects.toThrow("boom");
      off();
      const { taskCompletions } = await import("$lib/server/db");
      expect(test.db.select().from(taskCompletions).all()).toEqual([]);
      expect(getPart(ctx(), part.id).stockCount).toBe(4);
    });
  });

  describe("preparations that order a part", () => {
    it("are skipped while stock covers the quantity", async () => {
      const part = make({ stockCount: 2 });
      const task = await makeTask(ctx(), {
        trigger: { v: 1, type: "one_off", date: "2026-06-16" },
      });
      await createPreparation(ctx(), task.id, {
        title: "Patrone bestellen",
        kind: "order_part",
        partId: part.id,
        qty: 2,
        leadDays: 5,
      });
      const state = async () =>
        (await listPreparations(ctx(), task.id))[0].state;
      expect(await state()).toBe("in_stock_skip");
      bookStock(ctx(), part.id, { delta: -1, reason: "used", userId: null });
      expect(await state()).toBe("now");
    });

    it("stay normal without a part or for generic preparations", async () => {
      const part = make({ stockCount: 9 });
      const task = await makeTask(ctx(), {
        trigger: { v: 1, type: "one_off", date: "2026-06-16" },
      });
      await createPreparation(ctx(), task.id, {
        title: "Ohne Teil",
        kind: "order_part",
        qty: 1,
        leadDays: 5,
      });
      await createPreparation(ctx(), task.id, {
        title: "Generisch",
        kind: "generic",
        partId: part.id,
        qty: 1,
        leadDays: 5,
      });
      expect(
        (await listPreparations(ctx(), task.id)).map((p) => p.state),
      ).toEqual(["now", "now"]);
    });

    it("rejects an unknown part", async () => {
      const task = await makeTask(ctx());
      await expect(
        createPreparation(ctx(), task.id, {
          title: "x",
          kind: "order_part",
          partId: "nope",
          qty: 1,
        }),
      ).rejects.toThrow(/Invalid request/);
    });
  });

  describe("order now", () => {
    const monthly = (date: string) => ({
      v: 1 as const,
      type: "one_off" as const,
      date,
    });
    const setup = async (
      over: { part?: Record<string, unknown>; qty?: number; due?: string } = {},
    ) => {
      const part = make({ leadTimeDays: 10, ...over.part });
      const task = await makeTask(ctx(), {
        title: "Filter wechseln",
        trigger: monthly(over.due ?? "2026-06-30"),
      });
      linkTaskPart(ctx(), task.id, part.id, over.qty ?? 1);
      return { part, task };
    };

    it("lists nothing before the order-by date", async () => {
      await setup({ due: "2026-07-10" });
      expect(listOrderNow(ctx())).toEqual([]);
    });

    it("lists a part from the order-by date, late afterwards", async () => {
      const { part, task } = await setup();
      const items = listOrderNow(ctx(at("2026-06-20")));
      expect(items).toEqual([
        expect.objectContaining({
          taskId: task.id,
          taskTitle: "Filter wechseln",
          partId: part.id,
          partName: "Filterpatrone",
          quantity: 1,
          neededBy: "2026-06-30",
          orderBy: "2026-06-20",
          late: false,
          stockCount: 0,
        }),
      ]);
      expect(listOrderNow(ctx(at("2026-06-21")))[0].late).toBe(true);
      expect(listOrderNow(ctx(at("2026-06-19")))).toEqual([]);
    });

    it("needs the quantity plus the minimum stock minus what is in stock", async () => {
      const { part } = await setup({
        qty: 2,
        part: { stockCount: 1, minStock: 2 },
      });
      expect(listOrderNow(ctx(at("2026-06-25")))[0].quantity).toBe(3);
      bookStock(ctx(), part.id, { delta: 4, reason: "bought", userId: null });
      expect(listOrderNow(ctx(at("2026-06-25")))).toEqual([]);
    });

    it("counts parts that are already on order as stock", async () => {
      const { part } = await setup();
      expect(listOrderNow(ctx(at("2026-06-25")))).toHaveLength(1);
      markOrdered(ctx(), part.id, 1);
      expect(listOrderNow(ctx(at("2026-06-25")))).toEqual([]);
      markOrdered(ctx(), part.id, 0);
      expect(listOrderNow(ctx(at("2026-06-25")))).toHaveLength(1);
    });

    it("uses the next due date of a recurring task", async () => {
      const part = make({ leadTimeDays: 5 });
      const task = await makeTask(ctx(), {
        trigger: everyDays(30, "2026-05-01", "completion"),
      });
      await completeTask(ctx(at("2026-06-01")), task.id, {
        kind: "done",
        source: "manual",
        userId: null,
        completedAt: at("2026-06-01"),
      });
      linkTaskPart(ctx(), task.id, part.id, 1);
      expect(listOrderNow(ctx(at("2026-06-14")))).toEqual([]);
      expect(listOrderNow(ctx(at("2026-06-26")))[0]).toMatchObject({
        neededBy: "2026-07-01",
        orderBy: "2026-06-26",
      });
    });

    it("ignores archived tasks and archived parts, and sorts by order-by date", async () => {
      const first = await setup({ due: "2026-06-25" });
      const second = await setup({ due: "2026-06-22" });
      const third = await setup({ due: "2026-06-23" });
      const { updateTask } = await import("$lib/server/tasks/tasks");
      await updateTask(ctx(), first.task.id, { archived: true });
      updatePart(ctx(), third.part.id, { archived: true });
      const items = listOrderNow(ctx(at("2026-06-30")));
      expect(items.map((i) => i.partId)).toEqual([second.part.id]);
    });

    it("lists a part for each task that needs it", async () => {
      const part = make({ leadTimeDays: 1 });
      for (const [title, date] of [
        ["B", "2026-06-20"],
        ["A", "2026-06-19"],
      ] as const) {
        const task = await makeTask(ctx(), { title, trigger: monthly(date) });
        linkTaskPart(ctx(), task.id, part.id, 1);
      }
      expect(
        listOrderNow(ctx(at("2026-06-25"))).map((i) => i.taskTitle),
      ).toEqual(["A", "B"]);
    });
  });
});
