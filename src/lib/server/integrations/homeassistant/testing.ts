import { afterAll, beforeEach } from "vitest";
import { getDB } from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "./fake-server";

/**
 * Test harness: one fake Home Assistant per test file, reset before every
 * test. `connect()` stores the household connection pointing at it (the way
 * the settings API does, token encrypted); call it inside a test, after
 * `useTestDB()` has opened the database.
 */
export function useFakeHomeAssistant(): {
  readonly fake: FakeHomeAssistant;
  connect(over?: {
    token?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): ReturnType<typeof saveConnection>;
} {
  const fake = startFakeHomeAssistant();
  afterAll(() => fake.stop());
  beforeEach(() => fake.reset());
  return {
    fake,
    connect: (over = {}) =>
      saveConnection({ db: getDB(), now: Date.now() }, "homeassistant", null, {
        baseUrl: fake.baseUrl,
        token: over.token ?? fake.token,
        allowInsecureTls: false,
        config: over.config,
        enabled: over.enabled,
      }),
  };
}
