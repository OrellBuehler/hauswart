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

interface Settlement {
  id: string;
  amountMinor: number;
}

describe("POST /api/v1/settlements with an idempotency key", () => {
  useTestDB();
  const KEY = "retry-key-0001";

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const carl = await createTestUser({ displayName: "Carl" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const pay = (json: object, c = call) =>
      c("POST", "/api/v1/settlements", {
        json: {
          fromUserId: ben.id,
          toUserId: anna.id,
          amountMinor: 5000,
          ...json,
        },
      });
    const count = async () =>
      (
        (await call("GET", "/api/v1/settlements")).body as {
          items: unknown[];
        }
      ).items.length;
    return { anna, ben, carl, call, pay, count };
  }

  it("answers 201 the first time and 200 with the same payment on a retry", async () => {
    const { pay, count } = await setup();
    const first = await pay({ idempotencyKey: KEY });
    expect(first.res.status).toBe(201);
    const retry = await pay({ idempotencyKey: KEY });
    expect(retry.res.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await count()).toBe(1);
  });

  it("records a payment per request without a key", async () => {
    const { pay, count } = await setup();
    expect((await pay({})).res.status).toBe(201);
    expect((await pay({})).res.status).toBe(201);
    expect(await count()).toBe(2);
  });

  it("is per person: another person's key is their own", async () => {
    const { anna, ben, pay, count } = await setup();
    const callBen = createCaller({ session: loginTestUser(ben).token });
    const a = await pay({ idempotencyKey: KEY });
    const b = await pay(
      { idempotencyKey: KEY, fromUserId: anna.id, toUserId: ben.id },
      callBen,
    );
    expect(b.res.status).toBe(201);
    expect((b.body as Settlement).id).not.toBe((a.body as Settlement).id);
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
    expect((retry.body as Settlement).id).toBe((first.body as Settlement).id);
    expect(await count()).toBe(1);
  });

  it("answers 409 for the same key with another payment, and 400 for a key that is too short", async () => {
    const { pay, count } = await setup();
    await pay({ idempotencyKey: KEY });
    const other = await pay({ idempotencyKey: KEY, amountMinor: 6000 });
    expect(other.res.status).toBe(409);
    expect(errorCode(other)).toBe("conflict");
    expect(errorDetailCode(other)).toBe("idempotency_key_reused");
    const short = await pay({ idempotencyKey: "short" });
    expect(short.res.status).toBe(400);
    expect(await count()).toBe(1);
  });

  it("works through the typed client", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const client = createApiClient(
      createInProcessFetch({
        bearer: createTestToken(anna, { scopes: ["read", "costs:write"] })
          .token,
      }),
    );
    const body = {
      fromUserId: ben.id,
      toUserId: anna.id,
      amountMinor: 1200,
      idempotencyKey: "typed-client-key",
    };
    const first = await client.call(endpoints.settlementsCreate, { body });
    const second = await client.call(endpoints.settlementsCreate, { body });
    expect(second.id).toBe(first.id);
  });
});
