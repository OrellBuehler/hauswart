import { describe, expect, it } from "vitest";
import { createApiClient } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
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

interface Cost {
  id: string;
  amountMinor: number;
}

describe("POST /api/v1/costs with an idempotency key", () => {
  useTestDB();
  const KEY = "retry-key-0001";

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const makeBook = async (name: string) =>
      (
        (await call("POST", "/api/v1/cost-books", { json: { name } })) as {
          body: { id: string };
        }
      ).body.id;
    const other = await makeBook("Zweit");
    const pay = (json: object, c = call) =>
      c("POST", "/api/v1/costs", {
        json: {
          title: "Einkauf",
          amountMinor: 2340,
          category: "groceries",
          date: "2026-06-10",
          ...json,
        },
      });
    const count = async () =>
      (
        (await call("GET", "/api/v1/costs")).body as {
          items: unknown[];
        }
      ).items.length;
    return { anna, ben, call, pay, count, other };
  }

  it("answers 201 the first time and 200 with the same entry on a retry", async () => {
    const { pay, count } = await setup();
    const first = await pay({ idempotencyKey: KEY });
    expect(first.res.status).toBe(201);
    const retry = await pay({ idempotencyKey: KEY });
    expect(retry.res.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await count()).toBe(1);
  });

  it("books an entry per request without a key", async () => {
    const { pay, count } = await setup();
    expect((await pay({})).res.status).toBe(201);
    expect((await pay({})).res.status).toBe(201);
    expect(await count()).toBe(2);
  });

  it("is per person: another person's key is their own", async () => {
    const { ben, pay, count } = await setup();
    const callBen = createCaller({ session: loginTestUser(ben).token });
    const a = await pay({ idempotencyKey: KEY });
    const b = await pay({ idempotencyKey: KEY }, callBen);
    expect(b.res.status).toBe(201);
    expect((b.body as Cost).id).not.toBe((a.body as Cost).id);
    expect(await count()).toBe(2);
  });

  it("is per person, whatever credential they use", async () => {
    const { anna, pay, count } = await setup();
    const viaToken = createCaller({
      bearer: createTestToken(anna, { scopes: ["read", "costs:write"] }).token,
    });
    const first = await pay({ idempotencyKey: KEY });
    const retry = await pay({ idempotencyKey: KEY }, viaToken);
    expect(retry.res.status).toBe(200);
    expect((retry.body as Cost).id).toBe((first.body as Cost).id);
    expect(await count()).toBe(1);
  });

  it("answers 409 for the same key with another entry, and 400 for a key that is too short", async () => {
    const { pay, count, other } = await setup();
    await pay({ idempotencyKey: KEY });
    for (const change of [{ amountMinor: 2341 }, { bookId: other }]) {
      const r = await pay({ idempotencyKey: KEY, ...change });
      expect([change, r.res.status, errorCode(r), errorDetailCode(r)]).toEqual([
        change,
        409,
        "conflict",
        "idempotency_key_reused",
      ]);
    }
    const short = await pay({ idempotencyKey: "short" });
    expect(short.res.status).toBe(400);
    expect(await count()).toBe(1);
  });

  it("frees the key once the entry is deleted", async () => {
    const { call, pay } = await setup();
    const first = await pay({ idempotencyKey: KEY });
    const gone = await call(
      "DELETE",
      `/api/v1/costs/${(first.body as Cost).id}`,
    );
    expect(gone.res.status).toBe(204);
    const again = await pay({ idempotencyKey: KEY });
    expect(again.res.status).toBe(201);
    expect((again.body as Cost).id).not.toBe((first.body as Cost).id);
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
      title: "Einkauf",
      amountMinor: 1200,
      category: "groceries" as const,
      idempotencyKey: "typed-client-key",
    };
    const first = await client.call(endpoints.costsCreate, { body });
    const second = await client.call(endpoints.costsCreate, { body });
    expect(second.id).toBe(first.id);
  });
});
