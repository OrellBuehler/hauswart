import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { plainJpeg, plainPng } from "$lib/server/files/test-images";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
  errorDetailCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";

interface Task {
  id: string;
}

describe("POST /api/v1/ai-tasks with an idempotency key", () => {
  useTestDB();
  useTestFilesDir();
  const KEY = "retry-key-0001";

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const send = (
      over: Record<string, unknown> = {},
      c = call,
      bytes: Uint8Array = plainPng(64, 48),
    ) =>
      c("POST", "/api/v1/ai-tasks", {
        form: {
          file: new File([bytes as BlobPart], "beleg.png", {
            type: "image/png",
          }),
          ...over,
        },
      });
    const count = async () =>
      (
        (await call("GET", "/api/v1/ai-tasks")).body as {
          items: unknown[];
        }
      ).items.length;
    return { anna, ben, call, send, count };
  }

  it("answers 201 the first time and 200 with the same task on a retry", async () => {
    const { send, count } = await setup();
    const first = await send({ idempotencyKey: KEY });
    expect(first.res.status).toBe(201);
    const retry = await send({ idempotencyKey: KEY });
    expect(retry.res.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await count()).toBe(1);
  });

  it("queues a task per request without a key", async () => {
    const { send, count } = await setup();
    expect((await send()).res.status).toBe(201);
    expect((await send()).res.status).toBe(201);
    expect(await count()).toBe(2);
  });

  it("is per person, whatever credential they use", async () => {
    const { anna, ben, send, count } = await setup();
    const viaToken = createCaller({
      bearer: createTestToken(anna, { scopes: ["read", "costs:write"] }).token,
    });
    const first = await send({ idempotencyKey: KEY });
    const retry = await send({ idempotencyKey: KEY }, viaToken);
    expect(retry.res.status).toBe(200);
    expect((retry.body as Task).id).toBe((first.body as Task).id);
    const callBen = createCaller({ session: loginTestUser(ben).token });
    const other = await send({ idempotencyKey: KEY }, callBen);
    expect(other.res.status).toBe(201);
    expect((other.body as Task).id).not.toBe((first.body as Task).id);
    expect(await count()).toBe(2);
  });

  it("answers 409 for the same key with another file, and 400 for a key that is too short", async () => {
    const { send, count } = await setup();
    await send({ idempotencyKey: KEY });
    const other = await send({ idempotencyKey: KEY }, undefined, plainJpeg());
    expect([
      other.res.status,
      errorCode(other),
      errorDetailCode(other),
    ]).toEqual([409, "conflict", "idempotency_key_reused"]);
    const short = await send({ idempotencyKey: "short" });
    expect(short.res.status).toBe(400);
    expect(await count()).toBe(1);
  });

  it("frees the key once the task is deleted", async () => {
    const { call, send } = await setup();
    const first = await send({ idempotencyKey: KEY });
    const gone = await call(
      "DELETE",
      `/api/v1/ai-tasks/${(first.body as Task).id}`,
    );
    expect(gone.res.status).toBe(204);
    const again = await send({ idempotencyKey: KEY });
    expect(again.res.status).toBe(201);
    expect((again.body as Task).id).not.toBe((first.body as Task).id);
  });

  it("works through the typed client", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(anna, { scopes: ["read", "costs:write"] })
          .token,
      }),
    );
    const body = {
      file: new File([plainPng(32, 32) as BlobPart], "beleg.png", {
        type: "image/png",
      }),
      kind: "receipt" as const,
      idempotencyKey: "typed-client-key",
    };
    const first = await client.call(endpoints.aiTasksCreate, { body });
    const second = await client.call(endpoints.aiTasksCreate, { body });
    expect(second.id).toBe(first.id);
  });
});
