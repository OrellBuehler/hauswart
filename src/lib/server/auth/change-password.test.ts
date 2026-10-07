import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import { authEvents, sessions, users } from "$lib/server/db";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { changePassword } from "./change-password";
import { verifyCredentials } from "./login";
import { verifyPassword } from "./password";
import {
  LoginRateLimiter,
  MAX_FAILURES_PER_USER_IP,
  RateLimitedError,
} from "./rate-limit";
import { validateSessionToken } from "./sessions";
import { verifyToken } from "./tokens";

const NEW_PASSWORD = "a-brand-new-password";
const IP = "203.0.113.7";

async function fieldErrorsOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        code: err.code,
        status: err.status,
        fields: (
          err.details as {
            body: { fieldErrors: Record<string, string[]> };
          }
        ).body.fieldErrors,
      };
    }
    throw err;
  }
  return null;
}

describe("changePassword", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db, Date.now());

  async function setup() {
    const user = await createTestUser({ username: "alice" });
    const current = loginTestUser(user);
    const input = (over: Record<string, unknown> = {}) => ({
      userId: user.id,
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
      keepSessionId: current.session.id,
      clientKey: IP,
      ...over,
    });
    return { user, current, input };
  }

  const storedHash = (id: string) =>
    test.db.select().from(users).where(eq(users.id, id)).get()!.passwordHash;

  it("replaces the password with a fresh argon2id hash", async () => {
    const { user, input } = await setup();
    const before = storedHash(user.id);
    await changePassword(ctx(), input());
    const after = storedHash(user.id);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$argon2id\$/);
    expect(after).not.toContain(NEW_PASSWORD);
    expect(await verifyPassword(NEW_PASSWORD, after)).toBe(true);
    expect(await verifyPassword(user.password, after)).toBe(false);
  });

  it("ends the user's other sessions, keeps the given one and other people's", async () => {
    const { user, current, input } = await setup();
    const phone = loginTestUser(user);
    const laptop = loginTestUser(user);
    const bob = await createTestUser();
    const bobSession = loginTestUser(bob);
    await changePassword(ctx(), input());
    expect(validateSessionToken(current.token)).not.toBeNull();
    expect(validateSessionToken(phone.token)).toBeNull();
    expect(validateSessionToken(laptop.token)).toBeNull();
    expect(validateSessionToken(bobSession.token)).not.toBeNull();
    expect(
      test.db
        .select()
        .from(sessions)
        .all()
        .map((s) => s.id)
        .sort(),
    ).toEqual([current.session.id, bobSession.session.id].sort());
  });

  it("keeps API tokens (unlike an administrator's reset)", async () => {
    const { user, input } = await setup();
    const mobile = createTestToken(user, { kind: "mobile" });
    const mcp = createTestToken(user, { kind: "mcp" });
    await changePassword(ctx(), input());
    expect(verifyToken(mobile.token)?.user.id).toBe(user.id);
    expect(verifyToken(mcp.token)?.user.id).toBe(user.id);
  });

  it("records one password_changed event with the user as actor, and nothing else", async () => {
    const { user, input } = await setup();
    await changePassword(ctx(), input());
    expect(
      test.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => [e.type, e.userId, e.actorId]),
    ).toEqual([["password_changed", user.id, user.id]]);
  });

  it("logs the change by user id without any secret", async () => {
    const { user, input } = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await changePassword(ctx(), input());
      const lines = info.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("password_changed");
      expect(lines).toContain(user.id);
      expect(lines).not.toContain(NEW_PASSWORD);
      expect(lines).not.toContain(user.password);
    } finally {
      info.mockRestore();
    }
  });

  it("answers a wrong current password with a field error and changes nothing", async () => {
    const { user, current, input } = await setup();
    const phone = loginTestUser(user);
    const token = createTestToken(user);
    const before = storedHash(user.id);
    const failure = await fieldErrorsOf(
      changePassword(ctx(), input({ currentPassword: "not-my-password" })),
    );
    expect(failure).toEqual({
      code: "invalid_request",
      status: 400,
      fields: { currentPassword: [expect.any(String)] },
    });
    expect(storedHash(user.id)).toBe(before);
    expect(validateSessionToken(current.token)).not.toBeNull();
    expect(validateSessionToken(phone.token)).not.toBeNull();
    expect(verifyToken(token.token)).not.toBeNull();
    expect(test.db.select().from(authEvents).all()).toHaveLength(0);
  });

  it("logs a refused attempt without the password", async () => {
    const { user, input } = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await fieldErrorsOf(
        changePassword(ctx(), input({ currentPassword: "secret-guess-123" })),
      );
      const lines = info.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("password_change_failed");
      expect(lines).toContain(user.id);
      expect(lines).not.toContain("secret-guess-123");
    } finally {
      info.mockRestore();
    }
  });

  it("refuses an unknown user", async () => {
    const { input } = await setup();
    await expect(
      changePassword(ctx(), input({ userId: "nobody" })),
    ).rejects.toMatchObject({ name: "AuthError", code: "user_not_found" });
  });

  describe("failed attempts share the sign-in budget", () => {
    it("blocks further attempts, even with the right password, after the allowed failures", async () => {
      const { user, input } = await setup();
      const limiter = new LoginRateLimiter();
      for (let i = 0; i < MAX_FAILURES_PER_USER_IP; i++) {
        expect(
          await fieldErrorsOf(
            changePassword(
              ctx(),
              input({ currentPassword: `wrong-attempt-${i}` }),
              limiter,
            ),
          ),
        ).not.toBeNull();
      }
      const before = storedHash(user.id);
      await expect(
        changePassword(ctx(), input(), limiter),
      ).rejects.toBeInstanceOf(RateLimitedError);
      expect(storedHash(user.id)).toBe(before);
    });

    it("counts failures made at the sign-in form, and the other way round", async () => {
      const { user, input } = await setup();
      const limiter = new LoginRateLimiter();
      for (let i = 0; i < MAX_FAILURES_PER_USER_IP - 1; i++) {
        expect(
          await verifyCredentials("alice", `wrong-login-${i}`, IP, limiter),
        ).toBeNull();
      }
      expect(
        await fieldErrorsOf(
          changePassword(
            ctx(),
            input({ currentPassword: "one-more-wrong" }),
            limiter,
          ),
        ),
      ).not.toBeNull();
      await expect(
        verifyCredentials("alice", user.password, IP, limiter),
      ).rejects.toBeInstanceOf(RateLimitedError);
    });

    it("a successful change clears the failures of that user and address", async () => {
      const { input } = await setup();
      const limiter = new LoginRateLimiter();
      for (let i = 0; i < MAX_FAILURES_PER_USER_IP - 1; i++) {
        await fieldErrorsOf(
          changePassword(
            ctx(),
            input({ currentPassword: `wrong-attempt-${i}` }),
            limiter,
          ),
        );
      }
      await changePassword(ctx(), input(), limiter);
      for (let i = 0; i < MAX_FAILURES_PER_USER_IP - 1; i++) {
        expect(
          await fieldErrorsOf(
            changePassword(
              ctx(),
              input({
                currentPassword: `wrong-again-${i}`,
                newPassword: "yet-another-password",
              }),
              limiter,
            ),
          ),
        ).not.toBeNull();
      }
    });

    it("keeps the budget per address: another address is not locked out", async () => {
      const { input } = await setup();
      const limiter = new LoginRateLimiter();
      for (let i = 0; i < MAX_FAILURES_PER_USER_IP; i++) {
        await fieldErrorsOf(
          changePassword(
            ctx(),
            input({ currentPassword: `wrong-attempt-${i}` }),
            limiter,
          ),
        );
      }
      await expect(
        changePassword(ctx(), input({ clientKey: "198.51.100.9" }), limiter),
      ).resolves.toBeUndefined();
    });
  });

  it("lets only one of two simultaneous changes win; the loser is told the current password is wrong", async () => {
    const { user, input } = await setup();
    const results = await Promise.allSettled([
      changePassword(ctx(), input({ newPassword: "first-new-password" })),
      changePassword(ctx(), input({ newPassword: "second-new-password" })),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = (lost[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ApiError);
    expect(
      (reason as ApiError).details as {
        body: { fieldErrors: Record<string, string[]> };
      },
    ).toMatchObject({
      body: { fieldErrors: { currentPassword: [expect.any(String)] } },
    });
    const winner = results[0].status === "fulfilled" ? "first" : "second";
    expect(
      await verifyPassword(`${winner}-new-password`, storedHash(user.id)),
    ).toBe(true);
    expect(
      test.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => e.type),
    ).toEqual(["password_changed"]);
  });
});
