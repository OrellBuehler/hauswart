import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AiTaskKind } from "$lib/api/enums";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createFuelLogRequestSchema } from "$lib/api/schemas/fuel-logs";
import { createAsset } from "$lib/server/assets/assets";
import {
  createAttachment,
  listAttachments,
  settleBackgroundWork,
} from "$lib/server/attachments/attachments";
import { createCostBook, updateCostBook } from "$lib/server/costs/books";
import { createCost, deleteCost, getCost } from "$lib/server/costs/costs";
import { aiTasks, attachments, costEntries } from "$lib/server/db";
import { plainJpeg, plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { sampleHeic, samplePdf, useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { createFuelLog, deleteFuelLog } from "$lib/server/vehicles/fuel-logs";
import {
  completeAiTask,
  createAiTask,
  deleteAiTask,
  dismissAiTask,
  getAiTask,
  listAiTasks,
} from "./ai-tasks";

describe("receipt queue", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const upload = (
      over: Partial<Parameters<typeof createAiTask>[1]> = {},
      userId = anna.id,
      now = NOW,
    ) =>
      createAiTask(
        ctx(now),
        {
          kind: "receipt",
          bytes: plainPng(64, 48),
          filename: "beleg.png",
          declaredMime: "image/png",
          ...over,
        },
        userId,
      );
    const cost = (over: Record<string, unknown> = {}, userId = anna.id) =>
      createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Einkauf",
          amountMinor: 2_340,
          category: "groceries",
          date: "2026-06-10",
          ...over,
        }),
        userId,
      );
    const attachmentsOf = (type: string, id: string) =>
      test.db
        .select()
        .from(attachments)
        .where(eq(attachments.ownerId, id))
        .all()
        .filter((row) => row.ownerType === type);
    return { anna, ben, upload, cost, attachmentsOf };
  }

  describe("putting a file in the queue", () => {
    it("stores an image as the task's attachment and starts the task pending, with the uploader and the hints", async () => {
      const { anna, upload, attachmentsOf } = await world();
      const book = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Reise" }),
      );
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Geschirrspüler" }),
      );
      const task = await upload({
        note: "Wocheneinkauf",
        bookId: book.id,
        assetId: asset.id,
      });
      expect(task).toMatchObject({
        kind: "receipt",
        status: "pending",
        note: "Wocheneinkauf",
        createdByUserId: anna.id,
        createdByName: "Anna",
        bookId: book.id,
        bookName: "Reise",
        assetId: asset.id,
        assetName: "Geschirrspüler",
        resultJson: null,
        dismissReason: null,
        completedAt: null,
        completedVia: null,
      });
      expect(task.createdAt.getTime()).toBe(NOW);
      expect(task.attachment).toMatchObject({
        ownerType: "ai_task",
        ownerId: task.id,
        mime: "image/png",
        width: 64,
        height: 48,
        uploadedBy: anna.id,
      });
      expect(task.attachmentId).toBe(task.attachment?.id);
      expect(attachmentsOf("ai_task", task.id)).toHaveLength(1);
    });

    it("keeps a PDF as it was uploaded", async () => {
      const { upload } = await world();
      const task = await upload({
        bytes: samplePdf(),
        filename: "rechnung.pdf",
        declaredMime: "application/pdf",
      });
      expect(task.attachment).toMatchObject({
        mime: "application/pdf",
        filename: "rechnung.pdf",
        width: null,
        thumbPath: null,
      });
    });

    it("needs no hints and no note", async () => {
      const { upload } = await world();
      const task = await upload({ note: null });
      expect(task).toMatchObject({
        note: null,
        bookId: null,
        bookName: null,
        assetId: null,
        assetName: null,
      });
    });

    it("refuses a book that does not exist or is archived, and a device that does not exist, and queues nothing", async () => {
      const { upload } = await world();
      const archived = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Alt" }),
      );
      const keep = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Neu" }),
      );
      updateCostBook(ctx(), archived.id, { archived: true });
      for (const [over, field] of [
        [{ bookId: "missing" }, "bookId"],
        [{ bookId: archived.id }, "bookId"],
        [{ assetId: "missing" }, "assetId"],
      ] as const) {
        const err = await failure(() => upload(over));
        expect([err.code, fieldErrors(err, field)]).toEqual([
          "invalid_request",
          [expect.any(String)],
        ]);
      }
      expect(keep.archivedAt).toBeNull();
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
    });

    it("refuses what is no image or PDF without leaving a task behind", async () => {
      const { upload } = await world();
      await expect(
        upload({ bytes: sampleHeic(), filename: "beleg.heic" }),
      ).rejects.toMatchObject({ code: "unsupported_heic" });
      await expect(
        upload({ bytes: Buffer.from("plain text"), filename: "x.txt" }),
      ).rejects.toMatchObject({ code: "unsupported_type" });
      await expect(
        upload({ bytes: new Uint8Array(0), filename: "leer.png" }),
      ).rejects.toMatchObject({ code: "empty" });
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
    });

    it("makes ai_task a valid attachment owner only for tasks that exist", async () => {
      const { anna, upload } = await world();
      const task = await upload();
      const more = await createAttachment(ctx(), {
        bytes: plainJpeg(),
        filename: "zwei.jpg",
        ownerType: "ai_task",
        ownerId: task.id,
        uploadedBy: anna.id,
      });
      expect(more.ownerId).toBe(task.id);
      await expect(
        createAttachment(ctx(), {
          bytes: plainJpeg(),
          filename: "drei.jpg",
          ownerType: "ai_task",
          ownerId: "missing",
          uploadedBy: anna.id,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  });

  describe("the list", () => {
    it("shows every member every task, newest first, and pages through them", async () => {
      const { anna, ben, upload } = await world();
      const first = await upload({}, anna.id, NOW);
      const second = await upload({}, ben.id, NOW + 1_000);
      const third = await upload({}, anna.id, NOW + 2_000);
      const all = listAiTasks(ctx(), {}, { limit: 50 });
      expect(all.items.map((t) => t.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
      expect(all.nextCursor).toBeNull();
      const firstPage = listAiTasks(ctx(), {}, { limit: 2 });
      expect(firstPage.items.map((t) => t.id)).toEqual([third.id, second.id]);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = listAiTasks(
        ctx(),
        {},
        { limit: 2, cursor: firstPage.nextCursor! },
      );
      expect(secondPage.items.map((t) => t.id)).toEqual([first.id]);
      expect(secondPage.nextCursor).toBeNull();
    });

    it("pages through tasks created in the same instant without skipping or repeating one", async () => {
      const { upload } = await world();
      const ids = [
        (await upload()).id,
        (await upload()).id,
        (await upload()).id,
        (await upload()).id,
        (await upload()).id,
      ];
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = listAiTasks(ctx(), {}, { limit: 2, cursor });
        seen.push(...page.items.map((t) => t.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it("filters by status and kind", async () => {
      const { upload, cost } = await world();
      const pending = await upload();
      const done = await upload();
      const dismissed = await upload();
      completeAiTask(
        ctx(),
        done.id,
        { createdCostIds: [cost().id] },
        "mcp",
        null,
      );
      dismissAiTask(ctx(), dismissed.id, {}, "mcp", null);
      const ids = (status?: "pending" | "done" | "dismissed") =>
        listAiTasks(ctx(), { status }, { limit: 50 })
          .items.map((t) => t.id)
          .sort();
      expect(ids("pending")).toEqual([pending.id]);
      expect(ids("done")).toEqual([done.id]);
      expect(ids("dismissed")).toEqual([dismissed.id]);
      expect(ids()).toHaveLength(3);
      test.db
        .update(aiTasks)
        .set({ kind: "fuel_receipt" satisfies AiTaskKind })
        .where(eq(aiTasks.id, pending.id))
        .run();
      expect(
        listAiTasks(ctx(), { kind: "fuel_receipt" }, { limit: 50 }).items.map(
          (t) => t.id,
        ),
      ).toEqual([pending.id]);
      expect(
        listAiTasks(ctx(), { kind: "receipt" }, { limit: 50 }).items,
      ).toHaveLength(2);
    });

    it("rejects a forged cursor with a 400", async () => {
      await world();
      expect(() =>
        listAiTasks(ctx(), {}, { limit: 5, cursor: "not-a-cursor" }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    });
  });

  describe("completing a task", () => {
    it("flags the cost entry for review, gives it the file as its receipt and keeps the result", async () => {
      const { anna, ben, upload, cost, attachmentsOf } = await world();
      const task = await upload();
      const entry = cost();
      const done = completeAiTask(
        ctx(NOW + 5_000),
        task.id,
        { createdCostIds: [entry.id], note: "Datum unleserlich" },
        "mcp",
        null,
      );
      expect(done).toMatchObject({
        status: "done",
        completedVia: "mcp",
        resultJson: {
          createdCostIds: [entry.id],
          createdFuelLogIds: [],
          note: "Datum unleserlich",
        },
      });
      expect(done.completedAt?.getTime()).toBe(NOW + 5_000);
      expect(done.resultCosts).toEqual([
        {
          id: entry.id,
          date: "2026-06-10",
          title: "Einkauf",
          amountMinor: 2_340,
          currency: "CHF",
          reviewNeeded: true,
        },
      ]);
      expect(getCost(ctx(), entry.id)).toMatchObject({
        reviewNeeded: true,
        reviewedAt: null,
      });
      // The file is the cost entry's receipt now, still the task's attachment, and nobody else's.
      expect(attachmentsOf("ai_task", task.id)).toEqual([]);
      const receipts = attachmentsOf("cost", entry.id);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.id).toBe(task.attachmentId);
      expect(done.attachment?.ownerType).toBe("cost");
      expect(done.createdByUserId).toBe(anna.id);
      expect(ben.id).not.toBe(anna.id);
    });

    it("gives the first entry the file itself and every other a copy of it, all pointing at one stored file", async () => {
      const { upload, cost, attachmentsOf } = await world();
      const task = await upload();
      const first = cost({ title: "Lebensmittel" });
      const second = cost({ title: "Haushalt", category: "household" });
      const third = cost({ title: "Geschenk", category: "gifts" });
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [first.id, second.id, third.id] },
        "mcp",
        null,
      );
      const rows = [first, second, third].map(
        (c) => attachmentsOf("cost", c.id)[0]!,
      );
      expect(rows.map((r) => r?.id)).toEqual([
        task.attachmentId,
        expect.not.stringMatching(String(task.attachmentId)),
        expect.not.stringMatching(String(task.attachmentId)),
      ]);
      expect(new Set(rows.map((r) => r.sha256)).size).toBe(1);
      expect(new Set(rows.map((r) => r.path)).size).toBe(1);
      expect(rows.map((r) => r.uploadedBy)).toEqual([
        rows[0]?.uploadedBy,
        rows[0]?.uploadedBy,
        rows[0]?.uploadedBy,
      ]);
      expect(
        [first, second, third].every(
          (c) => getCost(ctx(), c.id).reviewNeeded === true,
        ),
      ).toBe(true);
    });

    it("keeps the stored file while any entry still has a copy, and removes it with the last", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      const a = cost({ title: "A" });
      const b = cost({ title: "B" });
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [a.id, b.id] },
        "mcp",
        null,
      );
      const [row] = test.db.select().from(attachments).all();
      const stored = join(files.dir, row!.path);
      const aged = new Date(Date.now() - 3_600_000);
      await utimes(stored, aged, aged);
      deleteCost(ctx(Date.now()), a.id);
      await settleBackgroundWork();
      expect(await Bun.file(stored).exists()).toBe(true);
      deleteCost(ctx(Date.now()), b.id);
      await settleBackgroundWork();
      expect(await Bun.file(stored).exists()).toBe(false);
    });

    it("flags the cost entry each fuel log entry booked and puts the receipt there; a free fill books no entry and takes none", async () => {
      const { anna, upload, attachmentsOf } = await world();
      const car = makeVehicle(test);
      const fill = (over: Record<string, unknown>) =>
        createFuelLog(
          ctx(),
          car.id,
          createFuelLogRequestSchema.parse({
            date: "2026-06-01",
            quantity: 40,
            ...over,
          }),
          anna.id,
        );
      const paid = fill({ odometer: 80_000, amountMinor: 7_200 });
      const free = fill({ odometer: 80_500, amountMinor: 0 });
      expect(free.costEntryId).toBeNull();
      const task = await upload();
      const done = completeAiTask(
        ctx(),
        task.id,
        { createdFuelLogIds: [free.id, paid.id] },
        "mcp",
        null,
      );
      expect(getCost(ctx(), paid.costEntryId!).reviewNeeded).toBe(true);
      expect(attachmentsOf("cost", paid.costEntryId!)).toHaveLength(1);
      expect(done.resultJson?.createdFuelLogIds).toEqual([free.id, paid.id]);
      expect(done.resultCosts.map((c) => c.id)).toEqual([paid.costEntryId]);
    });

    it("keeps the file with the task when the entries have none to take it (only a free fill)", async () => {
      const { anna, upload, attachmentsOf } = await world();
      const car = makeVehicle(test);
      const free = createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 12,
          amountMinor: 0,
        }),
        anna.id,
      );
      const task = await upload();
      const done = completeAiTask(
        ctx(),
        task.id,
        { createdFuelLogIds: [free.id] },
        "mcp",
        null,
      );
      expect(done.status).toBe("done");
      expect(attachmentsOf("ai_task", task.id)).toHaveLength(1);
      expect(done.resultCosts).toEqual([]);
    });

    it("counts an entry once when it is named and also booked by a named fuel log entry", async () => {
      const { anna, upload, attachmentsOf } = await world();
      const car = makeVehicle(test);
      const paid = createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 40,
          amountMinor: 7_200,
        }),
        anna.id,
      );
      const task = await upload();
      const done = completeAiTask(
        ctx(),
        task.id,
        {
          createdCostIds: [paid.costEntryId!, paid.costEntryId!],
          createdFuelLogIds: [paid.id],
        },
        "mcp",
        null,
      );
      expect(done.resultJson?.createdCostIds).toEqual([paid.costEntryId]);
      expect(attachmentsOf("cost", paid.costEntryId!)).toHaveLength(1);
      expect(done.resultCosts).toHaveLength(1);
    });

    it("flags an entry again that somebody had reviewed", async () => {
      const { ben, upload, cost } = await world();
      const entry = cost();
      test.db
        .update(costEntries)
        .set({
          reviewedAt: new Date(NOW),
          reviewedByUserId: ben.id,
        })
        .where(eq(costEntries.id, entry.id))
        .run();
      const task = await upload();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [entry.id] },
        "mcp",
        null,
      );
      expect(getCost(ctx(), entry.id)).toMatchObject({
        reviewNeeded: true,
        reviewedAt: null,
        reviewedByUserId: null,
      });
    });

    it("refuses entries that do not exist, names them, and changes nothing", async () => {
      const { upload, cost, attachmentsOf } = await world();
      const task = await upload();
      const real = cost();
      const badCost = await failure(() =>
        completeAiTask(
          ctx(),
          task.id,
          { createdCostIds: [real.id, "ghost-1", "ghost-2"] },
          "mcp",
          null,
        ),
      );
      expect(badCost.code).toBe("invalid_request");
      expect(fieldErrors(badCost, "createdCostIds")[0]).toContain("ghost-1");
      expect(fieldErrors(badCost, "createdCostIds")[0]).toContain("ghost-2");
      const badFuel = await failure(() =>
        completeAiTask(
          ctx(),
          task.id,
          { createdCostIds: [real.id], createdFuelLogIds: ["ghost-3"] },
          "mcp",
          null,
        ),
      );
      expect(fieldErrors(badFuel, "createdFuelLogIds")[0]).toContain("ghost-3");
      expect(getAiTask(ctx(), task.id)).toMatchObject({ status: "pending" });
      expect(getCost(ctx(), real.id).reviewNeeded).toBe(false);
      expect(attachmentsOf("ai_task", task.id)).toHaveLength(1);
      expect(attachmentsOf("cost", real.id)).toEqual([]);
    });

    it("is a 404 for a task that does not exist", async () => {
      const { cost } = await world();
      await expect(
        Promise.resolve().then(() =>
          completeAiTask(
            ctx(),
            "missing",
            { createdCostIds: [cost().id] },
            "mcp",
            null,
          ),
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("still completes when somebody deleted the file meanwhile", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      test.db
        .delete(attachments)
        .where(eq(attachments.id, task.attachmentId!))
        .run();
      const entry = cost();
      const done = completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [entry.id] },
        "mcp",
        null,
      );
      expect(done).toMatchObject({ status: "done", attachment: null });
      expect(getCost(ctx(), entry.id).reviewNeeded).toBe(true);
    });

    it("records a person in the browser as `session` and a token by its kind", async () => {
      const { upload, cost } = await world();
      const viaSession = completeAiTask(
        ctx(),
        (await upload()).id,
        { createdCostIds: [cost().id] },
        "session",
        null,
      );
      const viaToken = completeAiTask(
        ctx(),
        (await upload()).id,
        { createdCostIds: [cost().id] },
        "integration",
        null,
      );
      expect([viaSession.completedVia, viaToken.completedVia]).toEqual([
        "session",
        "integration",
      ]);
    });

    describe("completing twice", () => {
      it("answers the first result again for the same entries, in any order, and changes nothing", async () => {
        const { upload, cost, attachmentsOf } = await world();
        const task = await upload();
        const a = cost({ title: "A" });
        const b = cost({ title: "B" });
        const first = completeAiTask(
          ctx(NOW + 1_000),
          task.id,
          { createdCostIds: [a.id, b.id], note: "Erstes Mal" },
          "mcp",
          null,
        );
        const again = completeAiTask(
          ctx(NOW + 90_000),
          task.id,
          { createdCostIds: [b.id, a.id, b.id], note: "Anderer Text" },
          "session",
          null,
        );
        expect(again).toEqual(first);
        expect(again.resultJson?.note).toBe("Erstes Mal");
        expect(again.completedVia).toBe("mcp");
        expect(attachmentsOf("cost", a.id)).toHaveLength(1);
        expect(attachmentsOf("cost", b.id)).toHaveLength(1);
        expect(test.db.select().from(attachments).all()).toHaveLength(2);
      });

      it("does not flag again an entry a person reviewed in the meantime", async () => {
        const { ben, upload, cost } = await world();
        const task = await upload();
        const a = cost();
        completeAiTask(ctx(), task.id, { createdCostIds: [a.id] }, "mcp", null);
        test.db
          .update(costEntries)
          .set({ reviewNeeded: false, reviewedByUserId: ben.id })
          .where(eq(costEntries.id, a.id))
          .run();
        completeAiTask(ctx(), task.id, { createdCostIds: [a.id] }, "mcp", null);
        expect(getCost(ctx(), a.id).reviewNeeded).toBe(false);
      });

      it("is a 409 for other entries, and says what is recorded", async () => {
        const { upload, cost } = await world();
        const task = await upload();
        const a = cost({ title: "A" });
        const b = cost({ title: "B" });
        completeAiTask(ctx(), task.id, { createdCostIds: [a.id] }, "mcp", null);
        for (const other of [
          { createdCostIds: [a.id, b.id] },
          { createdCostIds: [b.id] },
        ]) {
          const err = await failure(() =>
            completeAiTask(ctx(), task.id, other, "mcp", null),
          );
          expect(err.code).toBe("conflict");
          expect(err.details).toMatchObject({
            status: "done",
            createdCostIds: [a.id],
          });
        }
        expect(getCost(ctx(), b.id).reviewNeeded).toBe(false);
      });

      it("treats an empty list of fuel log entries like none", async () => {
        const { upload, cost } = await world();
        const task = await upload();
        const a = cost();
        completeAiTask(ctx(), task.id, { createdCostIds: [a.id] }, "mcp", null);
        expect(
          completeAiTask(
            ctx(),
            task.id,
            { createdCostIds: [a.id], createdFuelLogIds: [] },
            "mcp",
            null,
          ).status,
        ).toBe("done");
      });

      it("is a 409 once the task was dismissed, and a dismissed task stays dismissed", async () => {
        const { upload, cost } = await world();
        const task = await upload();
        const a = cost();
        dismissAiTask(ctx(), task.id, { reason: "kein Beleg" }, "mcp", null);
        const err = await failure(() =>
          completeAiTask(
            ctx(),
            task.id,
            { createdCostIds: [a.id] },
            "mcp",
            null,
          ),
        );
        expect(err).toMatchObject({ code: "conflict" });
        expect(err.details).toMatchObject({ status: "dismissed" });
        expect(getAiTask(ctx(), task.id).status).toBe("dismissed");
        expect(getCost(ctx(), a.id).reviewNeeded).toBe(false);
      });
    });

    it("shows the cost entries that still exist and drops those deleted afterwards", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      const keep = cost({ title: "Bleibt" });
      const gone = cost({ title: "Weg" });
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [keep.id, gone.id] },
        "mcp",
        null,
      );
      deleteCost(ctx(), gone.id);
      const after = getAiTask(ctx(), task.id);
      expect(after.resultJson?.createdCostIds).toEqual([keep.id, gone.id]);
      expect(after.resultCosts.map((c) => c.title)).toEqual(["Bleibt"]);
    });

    it("loses the file reference when the entry holding the receipt is deleted", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      const entry = cost();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [entry.id] },
        "mcp",
        null,
      );
      deleteCost(ctx(), entry.id);
      expect(getAiTask(ctx(), task.id)).toMatchObject({
        status: "done",
        attachmentId: null,
        attachment: null,
      });
    });

    it("lists each fuel log entry's cost entry in a task's result and drops it with the fill", async () => {
      const { anna, upload } = await world();
      const car = makeVehicle(test);
      const paid = createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 40,
          amountMinor: 7_200,
        }),
        anna.id,
      );
      const task = await upload();
      completeAiTask(
        ctx(),
        task.id,
        { createdFuelLogIds: [paid.id] },
        "mcp",
        null,
      );
      expect(getAiTask(ctx(), task.id).resultCosts).toHaveLength(1);
      deleteFuelLog(ctx(), paid.id);
      expect(getAiTask(ctx(), task.id).resultCosts).toEqual([]);
    });
  });

  describe("dismissing a task", () => {
    it("closes it with the reason, who closed it and when, and keeps the file with the task", async () => {
      const { upload, attachmentsOf } = await world();
      const task = await upload();
      const dismissed = dismissAiTask(
        ctx(NOW + 2_000),
        task.id,
        { reason: "Das ist kein Beleg" },
        "mcp",
        null,
      );
      expect(dismissed).toMatchObject({
        status: "dismissed",
        dismissReason: "Das ist kein Beleg",
        completedVia: "mcp",
        resultJson: null,
      });
      expect(dismissed.completedAt?.getTime()).toBe(NOW + 2_000);
      expect(attachmentsOf("ai_task", task.id)).toHaveLength(1);
      expect(dismissed.attachment?.ownerType).toBe("ai_task");
    });

    it("needs no reason", async () => {
      const { upload } = await world();
      const task = await upload();
      expect(
        dismissAiTask(ctx(), task.id, { reason: null }, "session", null),
      ).toMatchObject({ status: "dismissed", dismissReason: null });
    });

    it("answers the same again when repeated, and the first reason stays", async () => {
      const { upload } = await world();
      const task = await upload();
      const first = dismissAiTask(
        ctx(NOW + 1_000),
        task.id,
        { reason: "erster Grund" },
        "mcp",
        null,
      );
      const again = dismissAiTask(
        ctx(NOW + 5_000),
        task.id,
        { reason: "zweiter Grund" },
        "session",
        null,
      );
      expect(again).toEqual(first);
      expect(again.dismissReason).toBe("erster Grund");
    });

    it("is a 409 for a task that is done, and a 404 for one that does not exist", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [cost().id] },
        "mcp",
        null,
      );
      const err = await failure(() =>
        dismissAiTask(ctx(), task.id, {}, "mcp", null),
      );
      expect(err.code).toBe("conflict");
      expect(err.details).toMatchObject({ status: "done" });
      expect(getAiTask(ctx(), task.id).status).toBe("done");
      const missing = await failure(() =>
        dismissAiTask(ctx(), "missing", {}, "mcp", null),
      );
      expect(missing.code).toBe("not_found");
    });
  });

  describe("deleting a task", () => {
    it("lets the uploader remove a pending task with its file", async () => {
      const { anna, upload } = await world();
      const task = await upload();
      const row = task.attachment!;
      const stored = join(files.dir, row.path);
      const aged = new Date(Date.now() - 3_600_000);
      await utimes(stored, aged, aged);
      deleteAiTask(ctx(Date.now()), anna, task.id);
      await settleBackgroundWork();
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(await Bun.file(stored).exists()).toBe(false);
    });

    it("lets an administrator remove another person's task", async () => {
      const { anna, ben, upload } = await world();
      const task = await upload({}, ben.id);
      deleteAiTask(ctx(), anna, task.id);
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
    });

    it("refuses another member with a 403 and removes nothing", async () => {
      const { anna, ben, upload } = await world();
      const task = await upload({}, anna.id);
      const err = await failure(() => deleteAiTask(ctx(), ben, task.id));
      expect(err.code).toBe("forbidden");
      expect(getAiTask(ctx(), task.id).status).toBe("pending");
      expect(test.db.select().from(attachments).all()).toHaveLength(1);
    });

    it("lets only an administrator remove a task whose uploader is gone", async () => {
      const { anna, ben, upload } = await world();
      const task = await upload({}, ben.id);
      test.db
        .update(aiTasks)
        .set({ createdByUserId: null })
        .where(eq(aiTasks.id, task.id))
        .run();
      expect(
        (await failure(() => deleteAiTask(ctx(), ben, task.id))).code,
      ).toBe("forbidden");
      deleteAiTask(ctx(), anna, task.id);
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
    });

    it("leaves the receipt on the cost entry when the task was done", async () => {
      const { anna, upload, cost, attachmentsOf } = await world();
      const task = await upload();
      const entry = cost();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [entry.id] },
        "mcp",
        null,
      );
      deleteAiTask(ctx(), anna, task.id);
      expect(test.db.select().from(aiTasks).all()).toEqual([]);
      expect(attachmentsOf("cost", entry.id)).toHaveLength(1);
      expect(
        listAttachments(
          ctx(),
          { ownerType: "cost", ownerId: entry.id },
          { limit: 10 },
        ).items,
      ).toHaveLength(1);
      expect(getCost(ctx(), entry.id).reviewNeeded).toBe(true);
    });

    it("removes the file of a dismissed task and is a 404 for a task that does not exist", async () => {
      const { anna, upload } = await world();
      const task = await upload();
      dismissAiTask(ctx(), task.id, {}, "mcp", null);
      deleteAiTask(ctx(), anna, task.id);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(
        (await failure(() => deleteAiTask(ctx(), anna, task.id))).code,
      ).toBe("not_found");
    });
  });
});
