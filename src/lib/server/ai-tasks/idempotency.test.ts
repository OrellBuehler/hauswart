import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createAiTaskRequestSchema } from "$lib/api/schemas/ai-tasks";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createAsset } from "$lib/server/assets/assets";
import { createCostBook, updateCostBook } from "$lib/server/costs/books";
import { createCost } from "$lib/server/costs/costs";
import { aiTasks, attachments } from "$lib/server/db";
import { plainJpeg, plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import {
  completeAiTask,
  deleteAiTask,
  recordAiTask,
  type NewAiTask,
} from "./ai-tasks";

describe("queueing a receipt twice", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const ctx = () => ctxAt(test.db);
  const KEY = "retry-key-0001";

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    return { anna, ben };
  }
  const queue = (over: Partial<NewAiTask>, userId: string) =>
    recordAiTask(
      ctx(),
      {
        kind: "receipt",
        bytes: plainPng(64, 48),
        filename: "beleg.png",
        declaredMime: "image/png",
        ...over,
      },
      userId,
    );
  const rows = () => test.db.select().from(aiTasks).all();
  const failure = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      return err as { code?: string };
    }
    return undefined;
  };

  it("returns the first task for the same key and queues nothing more", async () => {
    const { anna } = await setup();
    const first = await queue(
      { idempotencyKey: KEY, note: "Einkauf" },
      anna.id,
    );
    expect(first.replayed).toBe(false);
    const again = await queue(
      { idempotencyKey: KEY, note: "Einkauf" },
      anna.id,
    );
    expect(again.replayed).toBe(true);
    expect(again.task).toEqual(first.task);
    expect(rows()).toHaveLength(1);
    expect(test.db.select().from(attachments).all()).toHaveLength(1);
    expect(await readdir(files.dir)).toHaveLength(1);
  });

  it("queues every upload that has no key", async () => {
    const { anna } = await setup();
    const a = await queue({}, anna.id);
    const b = await queue({}, anna.id);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect(rows()).toHaveLength(2);
  });

  it("keeps the keys of two people apart", async () => {
    const { anna, ben } = await setup();
    const byAnna = await queue({ idempotencyKey: KEY }, anna.id);
    const byBen = await queue({ idempotencyKey: KEY }, ben.id);
    expect(byBen.replayed).toBe(false);
    expect(byBen.task.id).not.toBe(byAnna.task.id);
    expect((await queue({ idempotencyKey: KEY }, ben.id)).task.id).toBe(
      byBen.task.id,
    );
    expect(rows()).toHaveLength(2);
  });

  it("refuses the same key for another receipt and keeps the first", async () => {
    const { anna } = await setup();
    const book = createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "Reise" }),
    );
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    const first = await queue({ idempotencyKey: KEY }, anna.id);
    for (const other of [
      { bytes: plainJpeg(), filename: "zwei.jpg", declaredMime: "image/jpeg" },
      { bytes: plainPng(65, 48) },
      { bookId: book.id },
      { assetId: asset.id },
    ] as Partial<NewAiTask>[]) {
      const err = await failure(() =>
        queue({ idempotencyKey: KEY, ...other }, anna.id),
      );
      expect([Object.keys(other), err?.code]).toEqual([
        Object.keys(other),
        "conflict",
      ]);
    }
    expect(rows().map((r) => r.id)).toEqual([first.task.id]);
    expect(test.db.select().from(attachments).all()).toHaveLength(1);
    expect(await readdir(files.dir)).toHaveLength(1);
  });

  it("does not count the note: a retry may differ in it", async () => {
    const { anna } = await setup();
    const first = await queue(
      { idempotencyKey: KEY, note: "Einkauf" },
      anna.id,
    );
    const again = await queue(
      { idempotencyKey: KEY, note: "Einkauf, bar bezahlt" },
      anna.id,
    );
    expect(again.replayed).toBe(true);
    expect(again.task).toMatchObject({ id: first.task.id, note: "Einkauf" });
  });

  it("answers a retry with what the task is now, and does not look at the hints again", async () => {
    const { anna } = await setup();
    const book = createCostBook(
      ctx(),
      createCostBookRequestSchema.parse({ name: "Reise" }),
    );
    const first = await queue(
      { idempotencyKey: KEY, bookId: book.id },
      anna.id,
    );
    updateCostBook(ctx(), book.id, { archived: true });
    const cost = createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 2_340,
        category: "groceries",
      }),
      anna.id,
    );
    completeAiTask(
      ctx(),
      first.task.id,
      { createdCostIds: [cost.id] },
      "mcp",
      null,
    );
    const again = await queue(
      { idempotencyKey: KEY, bookId: book.id },
      anna.id,
    );
    expect(again.replayed).toBe(true);
    expect(again.task).toMatchObject({ id: first.task.id, status: "done" });
  });

  it("frees the key once the task is deleted", async () => {
    const { anna } = await setup();
    const first = await queue({ idempotencyKey: KEY }, anna.id);
    deleteAiTask(ctx(), anna, first.task.id);
    const again = await queue({ idempotencyKey: KEY }, anna.id);
    expect(again.replayed).toBe(false);
    expect(again.task.id).not.toBe(first.task.id);
  });

  it("checks a first request as before, and a refused request leaves the key unused", async () => {
    const { anna } = await setup();
    const bad = await failure(() =>
      queue({ idempotencyKey: KEY, assetId: "nobody" }, anna.id),
    );
    expect(bad?.code).toBe("invalid_request");
    expect(rows()).toHaveLength(0);
    expect((await queue({ idempotencyKey: KEY }, anna.id)).replayed).toBe(
      false,
    );
  });

  it("takes keys of 8 to 128 characters", () => {
    const parse = (idempotencyKey: string) =>
      createAiTaskRequestSchema.safeParse({
        file: new File([plainPng(8, 8) as BlobPart], "a.png"),
        idempotencyKey,
      }).success;
    expect(parse("1234567")).toBe(false);
    expect(parse("12345678")).toBe(true);
    expect(parse("x".repeat(128))).toBe(true);
    expect(parse("x".repeat(129))).toBe(false);
  });
});
