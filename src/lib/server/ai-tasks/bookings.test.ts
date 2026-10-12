import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createFuelLogRequestSchema } from "$lib/api/schemas/fuel-logs";
import {
  aiTasks,
  attachments,
  costEntries,
  financeSuggestions,
} from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import {
  countReviewNeeded,
  createCost,
  deleteCost,
  getCost,
  recordCost,
  reviewCost,
} from "$lib/server/costs/costs";
import {
  acceptSuggestion,
  recordSuggestion,
} from "$lib/server/finance/suggestions";
import { plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { createFuelLog } from "$lib/server/vehicles/fuel-logs";
import {
  completeAiTask,
  createAiTask,
  deleteAiTask,
  dismissAiTask,
  getAiTask,
} from "./ai-tasks";

describe("entries booked for a receipt task", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const upload = (now = NOW, userId = anna.id) =>
      createAiTask(
        ctx(now),
        { kind: "receipt", bytes: plainPng(64, 48), filename: "beleg.png" },
        userId,
      );
    const body = (over: Record<string, unknown> = {}) =>
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 2_340,
        category: "groceries",
        date: "2026-06-10",
        ...over,
      });
    const cost = (over: Record<string, unknown> = {}, now = NOW) =>
      createCost(ctx(now), body(over), anna.id);
    const car = makeVehicle(test);
    const fill = (
      taskId: string | undefined,
      over: Record<string, unknown>,
      now = NOW,
    ) =>
      createFuelLog(
        ctx(now),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          quantity: 40,
          receiptTaskId: taskId,
          ...over,
        }),
        anna.id,
      );
    return { anna, ben, upload, cost, body, fill };
  }

  describe("booking a cost for a task", () => {
    it("flags the entry for review at once and records it on the task", async () => {
      const { anna, upload, body } = await world();
      const task = await upload();
      const entry = createCost(
        ctx(),
        body({ receiptTaskId: task.id }),
        anna.id,
      );
      expect(entry).toMatchObject({
        aiTaskId: task.id,
        reviewNeeded: true,
        reviewedAt: null,
        reviewedByUserId: null,
      });
      expect(countReviewNeeded(ctx())).toBe(1);
      expect(getAiTask(ctx(), task.id).bookedSoFar).toEqual([
        {
          id: entry.id,
          date: "2026-06-10",
          title: "Einkauf",
          amountMinor: 2_340,
          currency: "CHF",
          reviewNeeded: true,
          fuelLogId: null,
        },
      ]);
    });

    it("leaves an entry without the id as it was: not flagged, not recorded", async () => {
      const { upload, cost } = await world();
      const task = await upload();
      const entry = cost();
      expect(entry).toMatchObject({ aiTaskId: null, reviewNeeded: false });
      expect(getAiTask(ctx(), task.id).bookedSoFar).toEqual([]);
    });

    it("lists what was booked in the order it was booked, per task, and drops what was deleted", async () => {
      const { anna, upload, body } = await world();
      const one = await upload();
      const two = await upload();
      const book = (taskId: string, title: string, now: number) =>
        createCost(ctx(now), body({ title, receiptTaskId: taskId }), anna.id);
      const b = book(one.id, "B", NOW + 2_000);
      const a = book(one.id, "A", NOW + 1_000);
      const c = book(two.id, "C", NOW + 3_000);
      expect(getAiTask(ctx(), one.id).bookedSoFar.map((e) => e.title)).toEqual([
        "A",
        "B",
      ]);
      expect(getAiTask(ctx(), two.id).bookedSoFar.map((e) => e.id)).toEqual([
        c.id,
      ]);
      deleteCost(ctx(), a.id);
      expect(getAiTask(ctx(), one.id).bookedSoFar.map((e) => e.id)).toEqual([
        b.id,
      ]);
    });

    it("keeps the entries, still flagged, when the task is deleted", async () => {
      const { anna, upload, body } = await world();
      const task = await upload();
      const entry = createCost(
        ctx(),
        body({ receiptTaskId: task.id }),
        anna.id,
      );
      deleteAiTask(ctx(), anna, task.id);
      expect(getCost(ctx(), entry.id)).toMatchObject({
        aiTaskId: null,
        reviewNeeded: true,
      });
    });

    it("refuses a task that does not exist, on the field, and books nothing", async () => {
      const { anna, body } = await world();
      const err = await failure(() =>
        createCost(ctx(), body({ receiptTaskId: "missing" }), anna.id),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "receiptTaskId")).toHaveLength(1);
      expect(test.db.select().from(costEntries).all()).toEqual([]);
    });

    it("refuses a task that is not waiting any more with a 409, and books nothing", async () => {
      const { anna, upload, cost, body } = await world();
      const done = await upload();
      completeAiTask(
        ctx(),
        done.id,
        { createdCostIds: [cost().id] },
        "mcp",
        null,
      );
      const dismissed = await upload();
      dismissAiTask(ctx(), dismissed.id, {}, "mcp", null);
      const before = test.db.select().from(costEntries).all().length;
      for (const [task, status] of [
        [done, "done"],
        [dismissed, "dismissed"],
      ] as const) {
        const err = await failure(() =>
          createCost(ctx(), body({ receiptTaskId: task.id }), anna.id),
        );
        expect([err.code, err.details]).toEqual([
          "conflict",
          expect.objectContaining({ status }),
        ]);
      }
      expect(test.db.select().from(costEntries).all()).toHaveLength(before);
    });

    it("books nothing and records nothing when the entry itself is refused", async () => {
      const { anna, upload, body } = await world();
      const task = await upload();
      const err = await failure(() =>
        createCost(
          ctx(),
          body({ receiptTaskId: task.id, assetId: "nobody" }),
          anna.id,
        ),
      );
      expect(err.code).toBe("invalid_request");
      expect(getAiTask(ctx(), task.id).bookedSoFar).toEqual([]);
    });

    it("replays a retried booking for the task, and a retry after the task closed is still answered with the first entry", async () => {
      const { anna, upload, body } = await world();
      const task = await upload();
      const request = body({
        receiptTaskId: task.id,
        idempotencyKey: "retry-key-0001",
      });
      const first = recordCost(ctx(), request, anna.id);
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [first.cost.id] },
        "mcp",
        null,
      );
      const again = recordCost(ctx(), request, anna.id);
      expect(again).toMatchObject({ replayed: true });
      expect(again.cost.id).toBe(first.cost.id);
      expect(
        test.db
          .select()
          .from(costEntries)
          .all()
          .filter((e) => e.aiTaskId),
      ).toHaveLength(1);
      // the same key for the same entry but another task (or none) is another request
      const other = await failure(() =>
        recordCost(ctx(), body({ idempotencyKey: "retry-key-0001" }), anna.id),
      );
      expect(other.code).toBe("conflict");
    });
  });

  describe("accepting a finance suggestion for a task", () => {
    async function inbox() {
      const w = await world();
      const connection = saveConnection(ctx(), "kept", w.anna.id, {
        baseUrl: "https://finance.example.org",
        token: "kept_example-token",
        allowInsecureTls: false,
      });
      const suggest = (ref: string, kind: "cost" | "asset" = "cost") =>
        recordSuggestion(ctx(), {
          connectionId: connection.id,
          userId: w.anna.id,
          kind,
          providerRef: `tx:${ref}`,
          payload:
            kind === "cost"
              ? {
                  source: "finance_transaction",
                  date: "2026-06-10",
                  amountMinor: 2_340,
                  currency: "CHF",
                  title: "Zahlung",
                  payee: "Beispiel AG",
                  category: "groceries",
                  url: null,
                  assetId: null,
                }
              : {
                  name: "Waschmaschine",
                  purchaseDate: "2026-06-10",
                  priceMinor: 90_000,
                  currency: "CHF",
                  url: null,
                },
        }).row;
      return { ...w, suggest };
    }

    it("flags the entry and records it on the task, like a booking", async () => {
      const { anna, upload, suggest } = await inbox();
      const task = await upload();
      const row = suggest("1");
      const { entity } = await acceptSuggestion(ctx(), anna.id, row.id, {
        receiptTaskId: task.id,
      });
      expect(getCost(ctx(), entity.id)).toMatchObject({
        aiTaskId: task.id,
        reviewNeeded: true,
      });
      expect(getAiTask(ctx(), task.id).bookedSoFar.map((e) => e.id)).toEqual([
        entity.id,
      ]);
    });

    it("leaves the suggestion pending when the task is closed, and books nothing", async () => {
      const { anna, upload, cost, suggest } = await inbox();
      const task = await upload();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [cost().id] },
        "mcp",
        null,
      );
      const row = suggest("1");
      const before = test.db.select().from(costEntries).all().length;
      const err = await failure(() =>
        acceptSuggestion(ctx(), anna.id, row.id, { receiptTaskId: task.id }),
      );
      expect(err.code).toBe("conflict");
      expect(test.db.select().from(costEntries).all()).toHaveLength(before);
      expect(
        test.db
          .select()
          .from(financeSuggestions)
          .where(eq(financeSuggestions.id, row.id))
          .get()?.status,
      ).toBe("pending");
    });

    it("refuses the id for a suggestion that is no cost", async () => {
      const { anna, upload, suggest } = await inbox();
      const task = await upload();
      const row = suggest("2", "asset");
      const err = await failure(() =>
        acceptSuggestion(ctx(), anna.id, row.id, { receiptTaskId: task.id }),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "receiptTaskId")).toHaveLength(1);
    });
  });

  describe("logging a fill for a task", () => {
    it("flags the cost entry of the fill and records it with the fuel log entry", async () => {
      const { upload, fill } = await world();
      const task = await upload();
      const paid = fill(task.id, { odometer: 80_000, amountMinor: 7_200 });
      expect(getCost(ctx(), paid.costEntryId!)).toMatchObject({
        aiTaskId: task.id,
        reviewNeeded: true,
      });
      expect(getAiTask(ctx(), task.id).bookedSoFar).toEqual([
        expect.objectContaining({
          id: paid.costEntryId,
          fuelLogId: paid.id,
          reviewNeeded: true,
        }),
      ]);
    });

    it("refuses the id for a free fill, which books no entry to record it on", async () => {
      const { upload, fill } = await world();
      const task = await upload();
      const err = await failure(() =>
        fill(task.id, { odometer: 80_000, amountMinor: 0 }),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "receiptTaskId")).toHaveLength(1);
    });

    it("refuses a closed task and leaves no fill behind", async () => {
      const { upload, cost, fill } = await world();
      const task = await upload();
      completeAiTask(
        ctx(),
        task.id,
        { createdCostIds: [cost().id] },
        "mcp",
        null,
      );
      const err = await failure(() =>
        fill(task.id, { odometer: 80_000, amountMinor: 7_200 }),
      );
      expect(err.code).toBe("conflict");
      expect(
        fill(undefined, { odometer: 80_000, amountMinor: 7_200 }),
      ).toBeDefined();
    });
  });

  describe("completing a task", () => {
    it("takes the entries booked for it, and does not touch their review: scenario A, a client that died after booking", async () => {
      const { anna, ben, upload, body } = await world();
      const task = await upload();
      // the first client books and is gone
      const first = createCost(
        ctx(NOW + 1_000),
        body({ title: "Erster", receiptTaskId: task.id }),
        anna.id,
      );
      // a person looks at it meanwhile
      reviewCost(ctx(NOW + 2_000), first.id, ben.id);
      // the next client reads bookedSoFar, books the rest and completes with everything
      const second = createCost(
        ctx(NOW + 3_000),
        body({ title: "Zweiter", receiptTaskId: task.id }),
        anna.id,
      );
      const done = completeAiTask(
        ctx(NOW + 4_000),
        task.id,
        { createdCostIds: [first.id, second.id] },
        "mcp",
        anna.id,
      );
      expect(done.status).toBe("done");
      expect(getCost(ctx(), first.id)).toMatchObject({
        reviewNeeded: false,
        reviewedByUserId: ben.id,
      });
      expect(getCost(ctx(), second.id).reviewNeeded).toBe(true);
      // the file went to the first entry named
      expect(
        test.db
          .select()
          .from(attachments)
          .all()
          .filter((a) => a.ownerType === "cost")
          .map((a) => a.ownerId),
      ).toEqual([first.id, second.id]);
    });

    it("refuses entries created before the task, on the field, and changes nothing", async () => {
      const { upload, cost } = await world();
      const early = cost({ title: "Schon da" }, NOW);
      const task = await upload(NOW + 60_000);
      const err = await failure(() =>
        completeAiTask(
          ctx(NOW + 61_000),
          task.id,
          { createdCostIds: [early.id], note: "x" },
          "mcp",
          null,
        ),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "createdCostIds")[0]).toContain(early.id);
      const after = getAiTask(ctx(), task.id);
      expect(after).toMatchObject({ status: "pending", resultJson: null });
      expect(after.attachment?.ownerType).toBe("ai_task");
      expect(getCost(ctx(), early.id).reviewNeeded).toBe(false);
    });

    it("takes an entry that was created after the task without being recorded for it, and flags it", async () => {
      const { upload, cost } = await world();
      const task = await upload(NOW);
      const later = cost({}, NOW + 1_000);
      expect(later.aiTaskId).toBeNull();
      completeAiTask(
        ctx(NOW + 2_000),
        task.id,
        { createdCostIds: [later.id] },
        "mcp",
        null,
      );
      expect(getCost(ctx(), later.id).reviewNeeded).toBe(true);
    });

    it("takes an entry created in the very moment of the task", async () => {
      const { upload, cost } = await world();
      const entry = cost({}, NOW);
      const task = await upload(NOW);
      expect(
        completeAiTask(
          ctx(),
          task.id,
          { createdCostIds: [entry.id] },
          "mcp",
          null,
        ).status,
      ).toBe("done");
    });

    it("refuses an entry that was booked for another task", async () => {
      const { anna, upload, body } = await world();
      const one = await upload();
      const two = await upload();
      const forTwo = createCost(
        ctx(NOW + 1_000),
        body({ receiptTaskId: two.id }),
        anna.id,
      );
      const err = await failure(() =>
        completeAiTask(
          ctx(NOW + 2_000),
          one.id,
          { createdCostIds: [forTwo.id] },
          "mcp",
          null,
        ),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "createdCostIds")[0]).toContain(forTwo.id);
      expect(getAiTask(ctx(), one.id).status).toBe("pending");
    });

    it("does not wipe the review of an entry a person confirmed that was created after the task but is not recorded for it", async () => {
      const { ben, upload, cost } = await world();
      const task = await upload(NOW);
      const entry = cost({}, NOW + 1_000);
      test.db
        .update(costEntries)
        .set({
          reviewNeeded: false,
          reviewedAt: new Date(NOW + 2_000),
          reviewedByUserId: ben.id,
        })
        .where(eq(costEntries.id, entry.id))
        .run();
      completeAiTask(
        ctx(NOW + 3_000),
        task.id,
        { createdCostIds: [entry.id] },
        "mcp",
        null,
      );
      expect(getCost(ctx(), entry.id)).toMatchObject({
        reviewNeeded: false,
        reviewedByUserId: ben.id,
      });
    });

    it("checks the fill of a fuel log entry the same way: created before the task is refused, after it is taken", async () => {
      const { upload, fill } = await world();
      const early = fill(undefined, { odometer: 79_000, amountMinor: 7_000 });
      const task = await upload(NOW + 60_000);
      const err = await failure(() =>
        completeAiTask(
          ctx(NOW + 61_000),
          task.id,
          { createdFuelLogIds: [early.id] },
          "mcp",
          null,
        ),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "createdFuelLogIds")[0]).toContain(early.id);
      expect(getCost(ctx(), early.costEntryId!).reviewNeeded).toBe(false);

      // booked for the task itself, after it was queued
      const own = fill(
        task.id,
        { odometer: 80_000, amountMinor: 7_200 },
        NOW + 62_000,
      );
      expect(
        completeAiTask(
          ctx(NOW + 63_000),
          task.id,
          { createdFuelLogIds: [own.id] },
          "mcp",
          null,
        ).status,
      ).toBe("done");
    });

    it("scenario B: two clients work on the same task - the second finds the task closed and is told what is recorded", async () => {
      const { anna, ben, upload, body } = await world();
      const task = await upload();
      const bookFor = (title: string, by: string, now: number) =>
        createCost(ctx(now), body({ title, receiptTaskId: task.id }), by);
      const a = bookFor("Von Anna", anna.id, NOW + 1_000);
      const b = bookFor("Von Ben", ben.id, NOW + 2_000);
      expect(getAiTask(ctx(), task.id).bookedSoFar.map((e) => e.id)).toEqual([
        a.id,
        b.id,
      ]);

      // the first to finish wins
      completeAiTask(
        ctx(NOW + 3_000),
        task.id,
        { createdCostIds: [a.id] },
        "mcp",
        anna.id,
      );
      // the other one can neither book more for it nor close it with something else
      const lateBooking = await failure(() =>
        createCost(
          ctx(NOW + 4_000),
          body({ title: "Zu spät", receiptTaskId: task.id }),
          ben.id,
        ),
      );
      expect(lateBooking.code).toBe("conflict");
      const lateClose = await failure(() =>
        completeAiTask(
          ctx(NOW + 5_000),
          task.id,
          { createdCostIds: [b.id] },
          "mcp",
          ben.id,
        ),
      );
      expect(lateClose.code).toBe("conflict");
      expect(lateClose.details).toMatchObject({
        status: "done",
        createdCostIds: [a.id],
      });
      // both entries are still there, flagged, for a person to sort out
      expect(getAiTask(ctx(), task.id).bookedSoFar.map((e) => e.id)).toEqual([
        a.id,
        b.id,
      ]);
      expect(getCost(ctx(), b.id).reviewNeeded).toBe(true);
      expect(
        test.db.select().from(aiTasks).where(eq(aiTasks.id, task.id)).get()
          ?.completedByUserId,
      ).toBe(anna.id);
    });
  });
});
