import { describe, expect, it } from "vitest";
import { AI_TASK_CLAIM_MINUTES } from "$lib/api/schemas/ai-tasks";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createCost } from "$lib/server/costs/costs";
import { plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { failure } from "$lib/testing/vehicles";
import {
  claimAiTask,
  claimIsActive,
  completeAiTask,
  createAiTask,
  dismissAiTask,
  getAiTask,
} from "./ai-tasks";

const MINUTE = 60_000;

describe("working on a receipt task: the lease", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const upload = () =>
      createAiTask(
        ctx(),
        { kind: "receipt", bytes: plainPng(64, 48), filename: "beleg.png" },
        anna.id,
      );
    const bookFor = (taskId: string, by: string, now: number) =>
      createCost(
        ctx(now),
        createCostRequestSchema.parse({
          title: "Einkauf",
          amountMinor: 2_340,
          category: "groceries",
          receiptTaskId: taskId,
        }),
        by,
      );
    return { anna, ben, upload, bookFor };
  }

  it("lasts fifteen minutes", () => {
    expect(AI_TASK_CLAIM_MINUTES).toBe(15);
    const at = new Date(NOW);
    expect(claimIsActive(at, NOW)).toBe(true);
    expect(claimIsActive(at, NOW + 15 * MINUTE - 1)).toBe(true);
    expect(claimIsActive(at, NOW + 15 * MINUTE)).toBe(false);
    expect(claimIsActive(null, NOW)).toBe(false);
  });

  it("starts with nobody on a new task", async () => {
    const { upload } = await world();
    expect(await upload()).toMatchObject({
      claimedByUserId: null,
      claimedByName: null,
      claimedAt: null,
    });
  });

  it("records who opened the task and when, without calling that a change of the task", async () => {
    const { ben, upload } = await world();
    const task = await upload();
    const claimed = claimAiTask(ctx(NOW + 2 * MINUTE), task.id, ben.id);
    expect(claimed).toMatchObject({
      status: "pending",
      claimedByUserId: ben.id,
      claimedByName: "Ben",
    });
    expect(claimed.claimedAt?.getTime()).toBe(NOW + 2 * MINUTE);
    expect(claimed.updatedAt).toEqual(task.updatedAt);
  });

  it("renews the lease for the same person", async () => {
    const { ben, upload } = await world();
    const task = await upload();
    claimAiTask(ctx(NOW), task.id, ben.id);
    const again = claimAiTask(ctx(NOW + 10 * MINUTE), task.id, ben.id);
    expect(again.claimedAt?.getTime()).toBe(NOW + 10 * MINUTE);
    expect(again.claimedByUserId).toBe(ben.id);
  });

  it("does not take the lease from somebody else while it lasts, and reports the holder", async () => {
    const { anna, ben, upload } = await world();
    const task = await upload();
    claimAiTask(ctx(NOW), task.id, anna.id);
    const second = claimAiTask(ctx(NOW + 5 * MINUTE), task.id, ben.id);
    expect(second).toMatchObject({
      claimedByUserId: anna.id,
      claimedByName: "Anna",
    });
    expect(second.claimedAt?.getTime()).toBe(NOW);
  });

  it("gives the lease to the next person once it ran out", async () => {
    const { anna, ben, upload } = await world();
    const task = await upload();
    claimAiTask(ctx(NOW), task.id, anna.id);
    const later = claimAiTask(ctx(NOW + 15 * MINUTE), task.id, ben.id);
    expect(later).toMatchObject({ claimedByUserId: ben.id });
    expect(later.claimedAt?.getTime()).toBe(NOW + 15 * MINUTE);
  });

  it("does not claim a task that is closed, and answers it as it is", async () => {
    const { anna, ben, upload } = await world();
    const done = await upload();
    const entry = createCost(
      ctx(),
      createCostRequestSchema.parse({
        title: "Einkauf",
        amountMinor: 100,
        category: "groceries",
      }),
      anna.id,
    );
    completeAiTask(
      ctx(),
      done.id,
      { createdCostIds: [entry.id] },
      "mcp",
      anna.id,
    );
    const dismissed = await upload();
    dismissAiTask(ctx(), dismissed.id, {}, "mcp", anna.id);
    for (const task of [done, dismissed]) {
      expect(claimAiTask(ctx(), task.id, ben.id)).toMatchObject({
        claimedByUserId: null,
        claimedAt: null,
      });
    }
  });

  it("is a 404 for a task that does not exist", async () => {
    const { ben } = await world();
    const err = await failure(() => claimAiTask(ctx(), "missing", ben.id));
    expect(err.code).toBe("not_found");
  });

  describe("booking for the task", () => {
    it("takes a free lease and renews one's own", async () => {
      const { ben, upload, bookFor } = await world();
      const task = await upload();
      bookFor(task.id, ben.id, NOW + MINUTE);
      expect(getAiTask(ctx(), task.id)).toMatchObject({
        claimedByUserId: ben.id,
      });
      bookFor(task.id, ben.id, NOW + 12 * MINUTE);
      expect(getAiTask(ctx(), task.id).claimedAt?.getTime()).toBe(
        NOW + 12 * MINUTE,
      );
    });

    it("leaves a lease somebody else holds alone: booking is not blocked", async () => {
      const { anna, ben, upload, bookFor } = await world();
      const task = await upload();
      claimAiTask(ctx(NOW), task.id, anna.id);
      const entry = bookFor(task.id, ben.id, NOW + 3 * MINUTE);
      expect(entry.aiTaskId).toBe(task.id);
      expect(getAiTask(ctx(), task.id)).toMatchObject({
        claimedByUserId: anna.id,
      });
      expect(getAiTask(ctx(), task.id).claimedAt?.getTime()).toBe(NOW);
    });

    it("takes over a lease that ran out", async () => {
      const { anna, ben, upload, bookFor } = await world();
      const task = await upload();
      claimAiTask(ctx(NOW), task.id, anna.id);
      bookFor(task.id, ben.id, NOW + 20 * MINUTE);
      expect(getAiTask(ctx(), task.id)).toMatchObject({
        claimedByUserId: ben.id,
      });
    });
  });
});
