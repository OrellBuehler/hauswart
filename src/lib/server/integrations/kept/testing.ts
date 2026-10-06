import { afterAll, beforeEach } from "vitest";
import { getDB } from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { startFakeKept, type FakeKept } from "./fake-server";

/**
 * Test harness: one fake Kept per test file, reset before every test.
 * `connect(userId)` stores that person's connection pointing at it (the way
 * the settings API does, token encrypted); call it inside a test, after
 * `useTestDB()` has opened the database.
 */
export function useFakeKept(): {
  readonly fake: FakeKept;
  connect(
    userId: string,
    over?: {
      token?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
      baseUrl?: string;
    },
  ): ReturnType<typeof saveConnection>;
} {
  const fake = startFakeKept();
  afterAll(() => fake.stop());
  beforeEach(() => fake.reset());
  return {
    fake,
    connect: (userId, over = {}) =>
      saveConnection({ db: getDB(), now: Date.now() }, "kept", userId, {
        baseUrl: over.baseUrl ?? fake.baseUrl,
        token: over.token ?? fake.token,
        allowInsecureTls: false,
        config: over.config,
        enabled: over.enabled,
      }),
  };
}
