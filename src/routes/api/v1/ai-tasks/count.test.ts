import { describe, expect, it } from "vitest";
import { endpoints } from "$lib/api/registry";
import { createApiClient } from "$lib/api/client";
import { plainPng } from "$lib/server/files/test-images";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";

describe("GET /api/v1/ai-tasks/count", () => {
  useTestDB();
  useTestFilesDir();

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const asAnna = createCaller({ session: loginTestUser(anna).token });
    const asBen = createCaller({ session: loginTestUser(ben).token });
    const upload = async (call = asAnna) =>
      (
        (await call("POST", "/api/v1/ai-tasks", {
          form: {
            file: new File([plainPng(64, 48) as BlobPart], "beleg.png", {
              type: "image/png",
            }),
          },
        })) as { body: { id: string } }
      ).body.id;
    const count = async (query = "", call = asAnna) =>
      (await call("GET", `/api/v1/ai-tasks/count${query}`)).body as {
        count: number;
      };
    return { anna, ben, asAnna, asBen, upload, count };
  }

  it("counts without a filter, by status and by kind, every member's tasks", async () => {
    const { asAnna, asBen, upload, count } = await world();
    expect(await count()).toEqual({ count: 0 });
    await upload(asAnna);
    await upload(asBen);
    const closed = await upload(asBen);
    await asAnna("POST", `/api/v1/ai-tasks/${closed}/dismiss`, { json: {} });
    expect(await count()).toEqual({ count: 3 });
    expect(await count("?status=pending")).toEqual({ count: 2 });
    expect(await count("?status=dismissed")).toEqual({ count: 1 });
    expect(await count("?status=done")).toEqual({ count: 0 });
    expect(await count("?status=pending&kind=receipt")).toEqual({ count: 2 });
    expect(await count("?kind=fuel_receipt")).toEqual({ count: 0 });
    // the same for every member
    expect(await count("?status=pending", asBen)).toEqual({ count: 2 });
  });

  it("is not mistaken for the task called count, and refuses what is no status", async () => {
    const { asAnna } = await world();
    const task = await asAnna("GET", "/api/v1/ai-tasks/count");
    expect(task.res.status).toBe(200);
    const bad = await asAnna("GET", "/api/v1/ai-tasks/count?status=open");
    expect([bad.res.status, errorCode(bad)]).toEqual([400, "invalid_request"]);
  });

  it("needs only the read scope and works through the typed client", async () => {
    const { ben, upload } = await world();
    await upload();
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(ben, { scopes: ["read"] }).token,
      }),
    );
    expect(
      await client.call(endpoints.aiTasksCount, {
        query: { status: "pending" },
      }),
    ).toEqual({ count: 1 });
  });
});
