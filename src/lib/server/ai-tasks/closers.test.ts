import { describe, expect, it } from "vitest";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createCost } from "$lib/server/costs/costs";
import { plainPng } from "$lib/server/files/test-images";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import {
  completeAiTask,
  createAiTask,
  dismissAiTask,
  getAiTask,
} from "./ai-tasks";

describe("who closed a receipt task", () => {
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
    const cost = () =>
      createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Einkauf",
          amountMinor: 2_340,
          category: "groceries",
        }),
        anna.id,
      );
    return { anna, ben, upload, cost };
  }

  it("has nobody while the task waits", async () => {
    const { upload } = await world();
    expect(await upload()).toMatchObject({
      completedByUserId: null,
      completedByName: null,
    });
  });

  it("records the person who completed it, with their name", async () => {
    const { ben, upload, cost } = await world();
    const task = await upload();
    const done = completeAiTask(
      ctx(),
      task.id,
      { createdCostIds: [cost().id] },
      "mcp",
      ben.id,
    );
    expect(done).toMatchObject({
      status: "done",
      completedVia: "mcp",
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
    expect(getAiTask(ctx(), task.id)).toMatchObject({
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
  });

  it("records the person who dismissed it", async () => {
    const { anna, upload } = await world();
    const task = await upload();
    expect(
      dismissAiTask(
        ctx(),
        task.id,
        { reason: "kein Beleg" },
        "session",
        anna.id,
      ),
    ).toMatchObject({
      status: "dismissed",
      completedVia: "session",
      completedByUserId: anna.id,
      completedByName: "Anna",
    });
  });

  it("keeps the first closer when the same call is repeated by somebody else", async () => {
    const { anna, ben, upload, cost } = await world();
    const entry = cost();
    const completed = await upload();
    completeAiTask(
      ctx(),
      completed.id,
      { createdCostIds: [entry.id] },
      "mcp",
      anna.id,
    );
    expect(
      completeAiTask(
        ctx(),
        completed.id,
        { createdCostIds: [entry.id] },
        "session",
        ben.id,
      ),
    ).toMatchObject({ completedByUserId: anna.id, completedVia: "mcp" });

    const dismissed = await upload();
    dismissAiTask(ctx(), dismissed.id, {}, "mcp", anna.id);
    expect(
      dismissAiTask(ctx(), dismissed.id, {}, "session", ben.id),
    ).toMatchObject({ completedByUserId: anna.id, completedVia: "mcp" });
  });

  it("leaves a closer null when no person is given", async () => {
    const { upload } = await world();
    const task = await upload();
    expect(dismissAiTask(ctx(), task.id, {}, "mcp", null)).toMatchObject({
      completedByUserId: null,
      completedByName: null,
    });
  });
});
