import { describe, expect, it } from "vitest";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import { plainPng } from "$lib/server/files/test-images";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";

describe("POST /api/v1/ai-tasks/{id}/claim", () => {
  useTestDB();
  useTestFilesDir();

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const asAnna = createCaller({ session: loginTestUser(anna).token });
    const asBen = createCaller({ session: loginTestUser(ben).token });
    const readOnly = createCaller({
      bearer: createTestToken(ben, { kind: "mcp", scopes: ["read"] }).token,
    });
    const upload = async () =>
      (
        await asAnna("POST", "/api/v1/ai-tasks", {
          form: {
            file: new File([plainPng(64, 48) as BlobPart], "beleg.png", {
              type: "image/png",
            }),
          },
        })
      ).body as AiTask;
    return { anna, ben, asAnna, asBen, readOnly, upload };
  }

  it("shows no lease on a task nobody works on", async () => {
    const { upload } = await world();
    expect((await upload()).claim).toBeNull();
  });

  it("marks the task as being worked on by the caller, for fifteen minutes", async () => {
    const { ben, asBen, asAnna, upload } = await world();
    const task = await upload();
    const r = await asBen("POST", `/api/v1/ai-tasks/${task.id}/claim`);
    expect(r.res.status).toBe(200);
    const claim = (r.body as AiTask).claim!;
    expect(claim).toMatchObject({ byUserId: ben.id, byName: "Ben" });
    expect(Date.parse(claim.expiresAt) - Date.parse(claim.at)).toBe(
      15 * 60_000,
    );
    // everybody sees it, on the task and in the list
    expect(
      (await asAnna("GET", `/api/v1/ai-tasks/${task.id}`)).body,
    ).toMatchObject({ claim: { byUserId: ben.id } });
    const list = (await asAnna("GET", "/api/v1/ai-tasks")).body as {
      items: AiTask[];
    };
    expect(list.items[0].claim).toMatchObject({ byName: "Ben" });
  });

  it("answers with the holder when somebody else has the lease", async () => {
    const { anna, asBen, asAnna, upload } = await world();
    const task = await upload();
    await asAnna("POST", `/api/v1/ai-tasks/${task.id}/claim`);
    const r = await asBen("POST", `/api/v1/ai-tasks/${task.id}/claim`);
    expect(r.res.status).toBe(200);
    expect((r.body as AiTask).claim).toMatchObject({
      byUserId: anna.id,
      byName: "Anna",
    });
  });

  it("shows no lease on a closed task", async () => {
    const { asAnna, asBen, upload } = await world();
    const task = await upload();
    await asBen("POST", `/api/v1/ai-tasks/${task.id}/claim`);
    await asAnna("POST", `/api/v1/ai-tasks/${task.id}/dismiss`, { json: {} });
    expect(
      ((await asAnna("GET", `/api/v1/ai-tasks/${task.id}`)).body as AiTask)
        .claim,
    ).toBeNull();
  });

  it("is a 404 for a task that does not exist and needs costs:write", async () => {
    const { asBen, readOnly, upload } = await world();
    const missing = await asBen("POST", "/api/v1/ai-tasks/missing/claim");
    expect([missing.res.status, errorCode(missing)]).toEqual([
      404,
      "not_found",
    ]);
    const task = await upload();
    const refused = await readOnly("POST", `/api/v1/ai-tasks/${task.id}/claim`);
    expect([refused.res.status, errorCode(refused)]).toEqual([
      403,
      "forbidden",
    ]);
  });
});
