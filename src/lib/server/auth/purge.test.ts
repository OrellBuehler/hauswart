import { afterEach, describe, expect, it, vi } from "vitest";
import { apiTokens, sessions } from "$lib/server/db";
import { createTestToken, createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { createSession, SESSION_MAX_LIFETIME_MS } from "./sessions";
import {
  EXPIRED_SESSION_RETENTION_MS,
  INACTIVE_TOKEN_RETENTION_MS,
  purgeStaleCredentials,
  startCredentialPurge,
} from "./purge";
import { revokeToken } from "./tokens";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("purgeStaleCredentials", () => {
  const ctx = useTestDB();

  it("keeps the retention windows", () => {
    expect(EXPIRED_SESSION_RETENTION_MS).toBe(7 * DAY);
    expect(INACTIVE_TOKEN_RETENTION_MS).toBe(30 * DAY);
  });

  it("deletes sessions that expired more than 7 days ago and keeps the rest", async () => {
    const user = await createTestUser();
    const fresh = createSession(user.id, NOW - 5 * DAY);
    const expiredRecently = createSession(user.id, NOW - 33 * DAY);
    const expiredLongAgo = createSession(user.id, NOW - 38 * DAY - 1000);
    const result = purgeStaleCredentials(NOW);
    expect(result.sessions).toBe(1);
    const left = ctx.db
      .select()
      .from(sessions)
      .all()
      .map((s) => s.id);
    expect(left.sort()).toEqual(
      [fresh.session.id, expiredRecently.session.id].sort(),
    );
    expect(left).not.toContain(expiredLongAgo.session.id);
  });

  it("deletes sessions older than the absolute lifetime even if they were refreshed", async () => {
    const user = await createTestUser();
    const old = createSession(user.id, NOW - SESSION_MAX_LIFETIME_MS - DAY);
    ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(NOW + 20 * DAY) })
      .run();
    expect(purgeStaleCredentials(NOW).sessions).toBe(1);
    expect(
      ctx.db
        .select()
        .from(sessions)
        .all()
        .map((s) => s.id),
    ).not.toContain(old.session.id);
  });

  it("deletes tokens revoked or expired more than 30 days ago and keeps the rest", async () => {
    const user = await createTestUser();
    const live = createTestToken(user, { kind: "mcp" });
    const liveNoExpiry = createTestToken(user, {
      kind: "integration",
      expiresAt: null,
    });
    const revokedRecently = createTestToken(user, { kind: "mcp" });
    const revokedLongAgo = createTestToken(user, { kind: "mcp" });
    const expiredRecently = createTestToken(user, {
      expiresAt: new Date(NOW - 10 * DAY),
    });
    const expiredLongAgo = createTestToken(user, {
      expiresAt: new Date(NOW - 31 * DAY),
    });
    revokeToken(user.id, revokedRecently.record.id, NOW - 29 * DAY);
    revokeToken(user.id, revokedLongAgo.record.id, NOW - 31 * DAY);
    const result = purgeStaleCredentials(NOW);
    expect(result.tokens).toBe(2);
    const left = ctx.db
      .select()
      .from(apiTokens)
      .all()
      .map((t) => t.id)
      .sort();
    expect(left).toEqual(
      [
        live.record.id,
        liveNoExpiry.record.id,
        revokedRecently.record.id,
        expiredRecently.record.id,
      ].sort(),
    );
    expect(left).not.toContain(revokedLongAgo.record.id);
    expect(left).not.toContain(expiredLongAgo.record.id);
  });

  it("does nothing on an empty database", () => {
    expect(purgeStaleCredentials(NOW)).toEqual({ sessions: 0, tokens: 0 });
  });
});

describe("startCredentialPurge", () => {
  const ctx = useTestDB();
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs after the first delay and then on every interval until stopped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const user = await createTestUser();
    createSession(user.id, NOW - 60 * DAY);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stop = startCredentialPurge({
      firstRunDelayMs: 1000,
      intervalMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]![0]))).toEqual({
      event: "auth.purge",
      sessions: 1,
      tokens: 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(info).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("logs a failing run and keeps going", async () => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stop = startCredentialPurge({ firstRunDelayMs: 10, intervalMs: 100 });
    // a closed database makes the purge throw
    ctx.db.$client.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(error.mock.calls[0]![0])).event).toBe(
      "auth.purge_failed",
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(error).toHaveBeenCalledTimes(2);
    stop();
  });
});
