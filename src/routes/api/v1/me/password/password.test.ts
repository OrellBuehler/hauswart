import { describe, expect, it } from "vitest";
import { PASSWORD_MAX, PASSWORD_MIN } from "$lib/api/schemas/auth";
import { authEvents, users } from "$lib/server/db";
import { MAX_FAILURES_PER_USER_IP } from "$lib/server/auth/rate-limit";
import { validateSessionToken } from "$lib/server/auth/sessions";
import { verifyToken } from "$lib/server/auth/tokens";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { POST as login } from "../../auth/login/+server";
import { GET as me } from "../../auth/me/+server";
import { POST as changePassword } from "./+server";

const NEW_PASSWORD = "a-brand-new-password";
const url = "http://localhost/api/v1/me/password";

type Failure = {
  error: {
    code: string;
    details?: { body?: { fieldErrors?: Record<string, string[]> } };
  };
};
const code = (r: { body: unknown }) => (r.body as Failure).error.code;
const fieldErrors = (r: { body: unknown }) =>
  (r.body as Failure).error.details?.body?.fieldErrors ?? {};

describe("POST /api/v1/me/password", () => {
  const ctx = useTestDB();

  const change = (session: string | undefined, json: unknown, extra = {}) =>
    callRoute(changePassword, { url, session, json, ...extra });
  const signIn = (username: string, password: string) =>
    callRoute(login, {
      url: "http://localhost/api/v1/auth/login",
      json: { username, password },
    });

  async function setup() {
    const user = await createTestUser({ username: "alice" });
    const current = loginTestUser(user);
    return { user, current };
  }

  it("changes the password: the new one signs in, the old one no longer does", async () => {
    const { user, current } = await setup();
    const r = await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect(r.res.status).toBe(204);
    expect(r.body).toBeNull();
    expect((await signIn("alice", NEW_PASSWORD)).res.status).toBe(200);
    const old = await signIn("alice", user.password);
    expect([old.res.status, code(old)]).toEqual([401, "invalid_credentials"]);
  });

  it("keeps the session that made the change and ends the user's other sessions", async () => {
    const { user, current } = await setup();
    const phone = loginTestUser(user);
    const bob = await createTestUser();
    const bobSession = loginTestUser(bob);
    await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    const stillIn = await callRoute(me, {
      url: "http://localhost/api/v1/auth/me",
      session: current.token,
    });
    expect(stillIn.res.status).toBe(200);
    expect(validateSessionToken(phone.token)).toBeNull();
    expect(validateSessionToken(bobSession.token)).not.toBeNull();
  });

  it("keeps the user's API tokens valid", async () => {
    const { user, current } = await setup();
    const mobile = createTestToken(user, { kind: "mobile" });
    const mcp = createTestToken(user, { kind: "mcp" });
    await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect(verifyToken(mobile.token)).not.toBeNull();
    expect(verifyToken(mcp.token)).not.toBeNull();
    const who = await callRoute(me, {
      url: "http://localhost/api/v1/auth/me",
      bearer: mobile.token,
    });
    expect(who.body).toMatchObject({ auth: "token", user: { id: user.id } });
  });

  it("records a password_changed event for the user", async () => {
    const { user, current } = await setup();
    await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect(
      ctx.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => [e.type, e.userId, e.actorId]),
    ).toEqual([["password_changed", user.id, user.id]]);
  });

  it("answers a wrong current password with a 400 field error, not 401, and changes nothing", async () => {
    const { user, current } = await setup();
    const phone = loginTestUser(user);
    const before = ctx.db.select().from(users).get()!.passwordHash;
    const r = await change(current.token, {
      currentPassword: "not-my-password",
      newPassword: NEW_PASSWORD,
    });
    expect([r.res.status, code(r)]).toEqual([400, "invalid_request"]);
    expect(Object.keys(fieldErrors(r))).toEqual(["currentPassword"]);
    expect(ctx.db.select().from(users).get()!.passwordHash).toBe(before);
    // a 401 would read as "your session expired": the session must be untouched
    expect(validateSessionToken(current.token)).not.toBeNull();
    expect(validateSessionToken(phone.token)).not.toBeNull();
    expect((await signIn("alice", user.password)).res.status).toBe(200);
    expect(ctx.db.select().from(authEvents).all()).toHaveLength(0);
  });

  it("counts wrong current passwords against the sign-in budget", async () => {
    const { user, current } = await setup();
    for (let i = 0; i < MAX_FAILURES_PER_USER_IP; i++) {
      const r = await change(current.token, {
        currentPassword: `wrong-attempt-${i}`,
        newPassword: NEW_PASSWORD,
      });
      expect(r.res.status).toBe(400);
    }
    const blocked = await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect([blocked.res.status, code(blocked)]).toEqual([429, "rate_limited"]);
    expect(Number(blocked.res.headers.get("retry-after"))).toBeGreaterThan(0);
    // the same budget applies at the sign-in form for this address
    const locked = await signIn("alice", user.password);
    expect(locked.res.status).toBe(429);
    // another address is not locked out
    const elsewhere = await change(
      current.token,
      { currentPassword: user.password, newPassword: NEW_PASSWORD },
      { ip: "198.51.100.9" },
    );
    expect(elsewhere.res.status).toBe(204);
  });

  it("failures at the sign-in form count towards the change", async () => {
    const { user, current } = await setup();
    for (let i = 0; i < MAX_FAILURES_PER_USER_IP; i++) {
      expect((await signIn("alice", `wrong-login-${i}`)).res.status).toBe(401);
    }
    const r = await change(current.token, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect([r.res.status, code(r)]).toEqual([429, "rate_limited"]);
  });

  it("validates the new password like setup and the administrator's reset", async () => {
    const { user, current } = await setup();
    const cases: [string, unknown][] = [
      ["too short", "x".repeat(PASSWORD_MIN - 1)],
      ["too long", "x".repeat(PASSWORD_MAX + 1)],
      ["not a string", 12345678901],
      ["same as the current one", user.password],
    ];
    for (const [name, newPassword] of cases) {
      const r = await change(current.token, {
        currentPassword: user.password,
        newPassword,
      });
      expect([name, r.res.status, code(r)]).toEqual([
        name,
        400,
        "invalid_request",
      ]);
      expect(Object.keys(fieldErrors(r)), name).toEqual(["newPassword"]);
    }
    expect((await signIn("alice", user.password)).res.status).toBe(200);
  });

  it("accepts the longest allowed password", async () => {
    const { user, current } = await setup();
    const longest = "p".repeat(PASSWORD_MAX);
    const r = await change(current.token, {
      currentPassword: user.password,
      newPassword: longest,
    });
    expect(r.res.status).toBe(204);
    expect((await signIn("alice", longest)).res.status).toBe(200);
  });

  it("requires both fields and rejects unknown ones", async () => {
    const { user, current } = await setup();
    const bodies: unknown[] = [
      {},
      { newPassword: NEW_PASSWORD },
      { currentPassword: user.password },
      { currentPassword: "", newPassword: NEW_PASSWORD },
      { currentPassword: user.password, newPassword: NEW_PASSWORD, extra: 1 },
      {
        currentPassword: user.password,
        newPassword: NEW_PASSWORD,
        userId: "x",
      },
    ];
    for (const json of bodies) {
      const r = await change(current.token, json);
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
    expect((await signIn("alice", user.password)).res.status).toBe(200);
  });

  it("only ever changes the caller's own password", async () => {
    const alice = await createTestUser({ username: "alice" });
    const bob = await createTestUser({
      username: "bob",
      password: "bobs-own-password-1",
    });
    const aliceSession = loginTestUser(alice);
    const bobSession = loginTestUser(bob);
    // Alice cannot name Bob: there is no id to send, and Bob's password is no good as hers.
    const attempt = await change(aliceSession.token, {
      currentPassword: bob.password,
      newPassword: NEW_PASSWORD,
    });
    expect([attempt.res.status, code(attempt)]).toEqual([
      400,
      "invalid_request",
    ]);
    expect((await signIn("bob", bob.password)).res.status).toBe(200);
    // A real change by Alice leaves Bob's password and sessions alone.
    await change(aliceSession.token, {
      currentPassword: alice.password,
      newPassword: NEW_PASSWORD,
    });
    expect((await signIn("bob", bob.password)).res.status).toBe(200);
    expect(validateSessionToken(bobSession.token)).not.toBeNull();
    expect((await signIn("alice", NEW_PASSWORD)).res.status).toBe(200);
  });

  it("is session-only: a token, even with every scope, is refused", async () => {
    const admin = await createTestUser({ role: "admin" });
    const token = createTestToken(admin, {
      scopes: ["read", "write", "docs:write", "costs:write", "admin"],
    });
    const r = await callRoute(changePassword, {
      url,
      bearer: token.token,
      json: { currentPassword: admin.password, newPassword: NEW_PASSWORD },
    });
    expect([r.res.status, code(r)]).toEqual([403, "forbidden"]);
    expect((await signIn(admin.username, admin.password)).res.status).toBe(200);
  });

  it("needs a login", async () => {
    await createTestUser();
    const r = await change(undefined, {
      currentPassword: "whatever-it-is",
      newPassword: NEW_PASSWORD,
    });
    expect([r.res.status, code(r)]).toEqual([401, "unauthenticated"]);
  });

  it("refuses cross-origin and origin-less posts before looking at the password", async () => {
    const { user, current } = await setup();
    const body = {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    };
    const cross = await change(current.token, body, {
      origin: "https://evil.example",
    });
    expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
    const none = await change(current.token, body, { origin: null });
    expect([none.res.status, code(none)]).toEqual([403, "csrf_failed"]);
    const form = await callRoute(changePassword, {
      url,
      session: current.token,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      rawBody: `currentPassword=${user.password}&newPassword=${NEW_PASSWORD}`,
    });
    expect([form.res.status, code(form)]).toEqual([403, "csrf_failed"]);
    expect((await signIn("alice", user.password)).res.status).toBe(200);
  });
});
