import { describe, expect, it, vi } from "vitest";
import { sessions } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import {
  LoginRateLimiter,
  RateLimitedError,
  loginRateLimiter,
} from "./rate-limit";
import {
  authenticate,
  clientKey,
  issueLogin,
  verifyCredentials,
} from "./login";
import { SESSION_LIFETIME_MS, validateSessionToken } from "./sessions";
import { AuthError } from "./types";

const T0 = 1_700_000_000_000;

describe("login", () => {
  const ctx = useTestDB();

  it("authenticates with the right password and issues a session", async () => {
    const user = await createTestUser({ username: "alice" });
    const result = await authenticate(
      "alice",
      user.password,
      "1.1.1.1",
      undefined,
      T0,
    );
    expect(result?.user.id).toBe(user.id);
    expect(result?.session.expiresAt.getTime()).toBe(T0 + SESSION_LIFETIME_MS);
    expect(validateSessionToken(result!.token, T0)?.user.username).toBe(
      "alice",
    );
  });

  it("returns null for a wrong password and an unknown user alike, without a session", async () => {
    const user = await createTestUser({ username: "alice" });
    expect(await authenticate("alice", "wrong-password", "1.1.1.1")).toBeNull();
    expect(await authenticate("nobody", user.password, "1.1.1.1")).toBeNull();
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("logs login successes and failures with the user id only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const user = await createTestUser({ username: "alice-login-log" });
    await verifyCredentials("alice-login-log", user.password, "1.1.1.1");
    await verifyCredentials("alice-login-log", "wrong-password-xyz", "1.1.1.1");
    await verifyCredentials(
      "nobody-login-log",
      "wrong-password-xyz",
      "1.1.1.1",
    );
    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { event: "auth.login_succeeded", userId: user.id },
      { event: "auth.login_failed", userId: user.id },
      { event: "auth.login_failed" },
    ]);
    const all = lines.join("\n");
    expect(all).not.toContain("alice-login-log");
    expect(all).not.toContain("nobody-login-log");
    expect(all).not.toContain("wrong-password-xyz");
    expect(all).not.toContain("1.1.1.1");
    info.mockRestore();
  });

  it("verifyCredentials checks without creating a session", async () => {
    const user = await createTestUser({ username: "alice" });
    const verified = await verifyCredentials("alice", user.password, "1.1.1.1");
    expect(verified).toMatchObject({
      id: user.id,
      username: "alice",
      locale: "de",
    });
    expect(verified).not.toHaveProperty("passwordHash");
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("limits repeated failures and reports RateLimitedError", async () => {
    await createTestUser({ username: "alice" });
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(
        await verifyCredentials("alice", "bad", "1.1.1.1", limiter),
      ).toBeNull();
    }
    await expect(
      verifyCredentials("alice", "bad", "1.1.1.1", limiter),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("blocks even the right password once the budget is spent", async () => {
    const user = await createTestUser({ username: "alice" });
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++)
      await verifyCredentials("alice", "bad", "9.9.9.9", limiter);
    await expect(
      verifyCredentials("alice", user.password, "9.9.9.9", limiter),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("counts parallel guesses immediately", async () => {
    await createTestUser({ username: "alice" });
    const limiter = new LoginRateLimiter();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        verifyCredentials("alice", "bad", "1.1.1.1", limiter),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
  });

  it("a success refunds the budget", async () => {
    const user = await createTestUser({ username: "alice" });
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 4; i++)
      await verifyCredentials("alice", "bad", "1.1.1.1", limiter);
    expect(
      await verifyCredentials("alice", user.password, "1.1.1.1", limiter),
    ).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(
        await verifyCredentials("alice", "bad", "1.1.1.1", limiter),
      ).toBeNull();
    }
  });

  it("shares the default limiter between login and device-token logins", async () => {
    await createTestUser({ username: "alice" });
    for (let i = 0; i < 3; i++) await authenticate("alice", "bad", "1.1.1.1");
    for (let i = 0; i < 2; i++)
      await verifyCredentials("alice", "bad", "1.1.1.1");
    await expect(
      authenticate("alice", "bad", "1.1.1.1"),
    ).rejects.toBeInstanceOf(RateLimitedError);
    loginRateLimiter.reset();
  });

  it("issueLogin purges expired sessions and rejects unknown users", async () => {
    const user = await createTestUser();
    issueLogin(user.id, T0);
    issueLogin(user.id, T0 + SESSION_LIFETIME_MS + 1);
    expect(ctx.db.select().from(sessions).all()).toHaveLength(1);
    expect(() => issueLogin("missing")).toThrow(AuthError);
  });
});

describe("clientKey", () => {
  it("uses the adapter's client address", () => {
    expect(clientKey(() => "203.0.113.9")).toBe("203.0.113.9");
  });

  it("keys IPv6 clients by their /64 prefix", () => {
    const key = (a: string) => clientKey(() => a);
    expect(key("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(key("2001:db8:1:2:1:2:3:4")).toBe(key("2001:DB8:1:2::9"));
    expect(key("2001:db8:1:3::1")).not.toBe(key("2001:db8:1:2::1"));
    expect(key("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(key("::1")).toBe("0:0:0:0::/64");
    expect(key("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(key("[2001:db8:1:2::5]")).toBe("2001:db8:1:2::/64");
  });

  it("maps IPv4-mapped IPv6 addresses to the IPv4 address", () => {
    const key = (a: string) => clientKey(() => a);
    expect(key("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(key("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    expect(key("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(key("0:0:0:0:0:ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("leaves IPv4 and unparseable addresses alone", () => {
    expect(clientKey(() => "198.51.100.4")).toBe("198.51.100.4");
    expect(clientKey(() => "not an address")).toBe("not an address");
  });

  it("falls back to one shared key when the address is unavailable", () => {
    expect(
      clientKey(() => {
        throw new Error("no address");
      }),
    ).toBe("unknown");
  });
});
