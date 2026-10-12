import { describe, expect, it } from "vitest";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import { plainPng } from "$lib/server/files/test-images";
import { createCaller } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";

describe("who closed a receipt task, through the API", () => {
  useTestDB();
  useTestFilesDir();

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const asAnna = createCaller({ session: loginTestUser(anna).token });
    const asBen = createCaller({ session: loginTestUser(ben).token });
    const viaBensToken = createCaller({
      bearer: createTestToken(ben, {
        kind: "mcp",
        scopes: ["read", "costs:write"],
      }).token,
    });
    const upload = async () => {
      const r = await asAnna("POST", "/api/v1/ai-tasks", {
        form: {
          file: new File([plainPng(64, 48) as BlobPart], "beleg.png", {
            type: "image/png",
          }),
        },
      });
      return r.body as AiTask;
    };
    const cost = async () =>
      (
        await asAnna("POST", "/api/v1/costs", {
          json: { title: "Einkauf", amountMinor: 2340, category: "groceries" },
        })
      ).body as { id: string };
    return { anna, ben, asAnna, asBen, viaBensToken, upload, cost };
  }

  it("shows nobody on a task that waits", async () => {
    const { upload } = await world();
    expect(await upload()).toMatchObject({
      completedByUserId: null,
      completedByName: null,
    });
  });

  it("names the person in the browser who completed it", async () => {
    const { ben, asBen, upload, cost } = await world();
    const task = await upload();
    const r = await asBen("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
      json: { createdCostIds: [(await cost()).id] },
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      status: "done",
      completedVia: "session",
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
  });

  it("names the owner of the token that dismissed it", async () => {
    const { ben, viaBensToken, asAnna, upload } = await world();
    const task = await upload();
    const r = await viaBensToken(
      "POST",
      `/api/v1/ai-tasks/${task.id}/dismiss`,
      { json: { reason: "doppelt" } },
    );
    expect(r.body).toMatchObject({
      status: "dismissed",
      completedVia: "mcp",
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
    const read = await asAnna("GET", `/api/v1/ai-tasks/${task.id}`);
    expect(read.body).toMatchObject({
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
  });

  it("lists it on every row of the queue", async () => {
    const { ben, asBen, asAnna, upload } = await world();
    const task = await upload();
    await asBen("POST", `/api/v1/ai-tasks/${task.id}/dismiss`, { json: {} });
    const list = (await asAnna("GET", "/api/v1/ai-tasks")).body as {
      items: AiTask[];
    };
    expect(list.items[0]).toMatchObject({
      completedByUserId: ben.id,
      completedByName: "Ben",
    });
  });
});
