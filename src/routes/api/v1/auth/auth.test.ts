import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "$lib/api/constants";
import { MOBILE_TOKEN_SCOPES } from "$lib/api/scopes";
import { apiTokens, sessions } from "$lib/server/db";
import { PUBLIC_POSTS_PER_MINUTE } from "$lib/server/auth/rate-limit";
import { validateSessionToken } from "$lib/server/auth/sessions";
import { MOBILE_TOKEN_LIFETIME_MS, verifyToken } from "$lib/server/auth/tokens";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { POST as login } from "./login/+server";
import { POST as logout } from "./logout/+server";
import { GET as me, PATCH as updateMe } from "./me/+server";
import { DELETE as revokeToken, POST as issueToken } from "./token/+server";

const url = (path: string) => `http://localhost/api/v1/auth/${path}`;
const code = (r: { body: unknown }) =>
  (r.body as { error: { code: string } }).error.code;

describe("POST /api/v1/auth/login", () => {
  const ctx = useTestDB();
  const attempt = (username: string, password: string, extra = {}) =>
    callRoute(login, {
      url: url("login"),
      json: { username, password },
      ...extra,
    });

  it("signs in, sets the session and locale cookies and returns the user", async () => {
    const user = await createTestUser({
      username: "alice",
      displayName: "Alice",
      locale: "en",
    });
    const r = await attempt("Alice", user.password);
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      user: {
        id: user.id,
        username: "alice",
        displayName: "Alice",
        role: "member",
        locale: "en",
      },
    });
    const token = r.cookies.get(SESSION_COOKIE)!;
    expect(validateSessionToken(token)?.user.id).toBe(user.id);
    expect(r.cookies.options(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
    });
    expect(r.cookies.get("PARAGLIDE_LOCALE")).toBe("en");
  });

  it("replaces the browser's previous session", async () => {
    const user = await createTestUser({ username: "alice" });
    const old = loginTestUser(user);
    const r = await attempt("alice", user.password, { session: old.token });
    expect(r.res.status).toBe(200);
    expect(validateSessionToken(old.token)).toBeNull();
    expect(validateSessionToken(r.cookies.get(SESSION_COOKIE)!)).not.toBeNull();
  });

  it("answers wrong passwords and unknown users identically", async () => {
    const user = await createTestUser({ username: "alice" });
    const wrong = await attempt("alice", "not-the-password");
    const unknown = await attempt("nobody", user.password);
    for (const r of [wrong, unknown]) {
      expect(r.res.status).toBe(401);
      expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
    }
    expect(wrong.body).toEqual(unknown.body);
    expect(code(wrong)).toBe("invalid_credentials");
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("does the same password work for unknown and known users (uniform timing)", async () => {
    const user = await createTestUser({ username: "alice" });
    const verify = vi.spyOn(Bun.password, "verify");
    try {
      await attempt("alice", "wrong-password");
      await attempt("nobody", "wrong-password");
      expect(verify).toHaveBeenCalledTimes(2);
    } finally {
      verify.mockRestore();
    }
    expect(user.id).toBeTruthy();
  });

  it("rate limits repeated failures with 429 and Retry-After, per user and address", async () => {
    const user = await createTestUser({ username: "alice" });
    for (let i = 0; i < 5; i++)
      expect((await attempt("alice", "bad")).res.status).toBe(401);
    const blocked = await attempt("alice", user.password);
    expect([blocked.res.status, code(blocked)]).toEqual([429, "rate_limited"]);
    expect(Number(blocked.res.headers.get("retry-after"))).toBeGreaterThan(0);
    // the tight counter is per address: the owner on another address is not locked out
    const elsewhere = await attempt("alice", user.password, {
      ip: "198.51.100.9",
    });
    expect(elsewhere.res.status).toBe(200);
    const another = await createTestUser({ username: "bob" });
    expect((await attempt("bob", another.password)).res.status).toBe(200);
  });

  it("limits request volume per client address", async () => {
    for (let i = 0; i < PUBLIC_POSTS_PER_MINUTE; i++) {
      await attempt(`user${i}`, "x", { ip: "198.51.100.20" });
    }
    const r = await attempt("alice", "x", { ip: "198.51.100.20" });
    expect(r.res.status).toBe(429);
  });

  it("refuses cross-origin and origin-less posts without touching credentials", async () => {
    const user = await createTestUser({ username: "alice" });
    const cross = await attempt("alice", user.password, {
      origin: "https://evil.example",
    });
    expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
    expect(cross.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(
      (await attempt("alice", user.password, { origin: null })).res.status,
    ).toBe(403);
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("validates the body", async () => {
    expect(
      (
        await callRoute(login, {
          url: url("login"),
          json: { username: "alice" },
        })
      ).res.status,
    ).toBe(400);
    expect(
      (
        await callRoute(login, {
          url: url("login"),
          json: { username: "", password: "x" },
        })
      ).res.status,
    ).toBe(400);
  });
});

describe("POST /api/v1/auth/logout", () => {
  const ctx = useTestDB();

  it("ends the session and clears the cookie", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const r = await callRoute(logout, {
      url: url("logout"),
      method: "POST",
      session: s.token,
    });
    expect(r.res.status).toBe(204);
    expect(r.body).toBeNull();
    expect(r.cookies.deleted).toContain(SESSION_COOKIE);
    expect(validateSessionToken(s.token)).toBeNull();
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("only ends the caller's own session", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const sa = loginTestUser(a);
    const sb = loginTestUser(b);
    await callRoute(logout, {
      url: url("logout"),
      method: "POST",
      session: sa.token,
    });
    expect(validateSessionToken(sb.token)).not.toBeNull();
  });

  it("is refused cross-origin and for bearer tokens, and needs a login", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const cross = await callRoute(logout, {
      url: url("logout"),
      method: "POST",
      session: s.token,
      origin: "https://evil.example",
    });
    expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
    expect(validateSessionToken(s.token)).not.toBeNull();
    const t = createTestToken(user);
    expect(
      (
        await callRoute(logout, {
          url: url("logout"),
          method: "POST",
          bearer: t.token,
        })
      ).res.status,
    ).toBe(403);
    expect(
      (await callRoute(logout, { url: url("logout"), method: "POST" })).res
        .status,
    ).toBe(401);
  });
});

describe("GET /api/v1/auth/me", () => {
  useTestDB();

  it("describes a session caller with all scopes of their role", async () => {
    const user = await createTestUser({ displayName: "Mia", locale: "en" });
    const s = loginTestUser(user);
    const r = await callRoute(me, { url: url("me"), session: s.token });
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      user: {
        id: user.id,
        username: user.username,
        displayName: "Mia",
        role: "member",
        locale: "en",
      },
      auth: "session",
      scopes: ["read", "write", "docs:write", "costs:write", "ha:action"],
    });
  });

  it("gives administrators the admin scope", async () => {
    const admin = await createTestUser({ role: "admin" });
    const r = await callRoute(me, {
      url: url("me"),
      session: loginTestUser(admin).token,
    });
    expect((r.body as { scopes: string[] }).scopes).toContain("admin");
  });

  it("describes a token caller with the token's scopes", async () => {
    const user = await createTestUser();
    const t = createTestToken(user, {
      kind: "ha",
      scopes: ["read", "ha:action"],
    });
    const r = await callRoute(me, { url: url("me"), bearer: t.token });
    expect(r.body).toMatchObject({
      auth: "token",
      scopes: ["read", "ha:action"],
      user: { id: user.id },
    });
  });

  it("caps an admin-scoped token by the owner's role", async () => {
    const user = await createTestUser();
    const t = createTestToken(user, { scopes: ["read", "admin"] });
    const r = await callRoute(me, { url: url("me"), bearer: t.token });
    expect((r.body as { scopes: string[] }).scopes).toEqual(["read"]);
  });

  it("needs credentials, and rejects revoked, expired and garbage tokens", async () => {
    const user = await createTestUser();
    expect((await callRoute(me, { url: url("me") })).res.status).toBe(401);
    const expired = createTestToken(user, {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await callRoute(me, { url: url("me"), bearer: expired.token })).res
        .status,
    ).toBe(401);
    expect(
      (await callRoute(me, { url: url("me"), bearer: "hw_nonsense" })).res
        .status,
    ).toBe(401);
    expect(
      (
        await callRoute(me, {
          url: url("me"),
          headers: { authorization: "Bearer" },
        })
      ).res.status,
    ).toBe(401);
  });

  it("does not fall back to the cookie when a bearer token is invalid", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const r = await callRoute(me, {
      url: url("me"),
      session: s.token,
      bearer: "hw_nonsense",
    });
    expect(r.res.status).toBe(401);
  });

  it("ignores a non-bearer Authorization header (e.g. proxy basic auth) and uses the cookie", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const r = await callRoute(me, {
      url: url("me"),
      session: s.token,
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(r.res.status).toBe(200);
  });
});

describe("PATCH /api/v1/auth/me", () => {
  useTestDB();

  it("updates display name and language and sets the locale cookie", async () => {
    const user = await createTestUser({ displayName: "Old" });
    const s = loginTestUser(user);
    const r = await callRoute(updateMe, {
      url: url("me"),
      method: "PATCH",
      session: s.token,
      json: { displayName: " New Name ", locale: "en" },
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      user: {
        id: user.id,
        username: user.username,
        displayName: "New Name",
        role: "member",
        locale: "en",
      },
    });
    expect(r.cookies.get("PARAGLIDE_LOCALE")).toBe("en");
  });

  it("does not touch the locale cookie when only the name changes", async () => {
    const user = await createTestUser();
    const r = await callRoute(updateMe, {
      url: url("me"),
      method: "PATCH",
      session: loginTestUser(user).token,
      json: { displayName: "Only" },
    });
    expect(r.cookies.get("PARAGLIDE_LOCALE")).toBeUndefined();
  });

  it("validates the body and rejects fields it does not own", async () => {
    const s = loginTestUser(await createTestUser());
    for (const json of [
      {},
      { locale: "fr" },
      { role: "admin" },
      { displayName: "" },
    ]) {
      const r = await callRoute(updateMe, {
        url: url("me"),
        method: "PATCH",
        session: s.token,
        json,
      });
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
  });

  it("is session-only and CSRF-protected", async () => {
    const user = await createTestUser();
    const t = createTestToken(user);
    const bearer = await callRoute(updateMe, {
      url: url("me"),
      method: "PATCH",
      bearer: t.token,
      json: { locale: "en" },
    });
    expect(bearer.res.status).toBe(403);
    const cross = await callRoute(updateMe, {
      url: url("me"),
      method: "PATCH",
      session: loginTestUser(user).token,
      json: { locale: "en" },
      origin: "https://evil.example",
    });
    expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
  });
});

describe("POST /api/v1/auth/token", () => {
  const ctx = useTestDB();
  const exchange = (json: unknown, extra = {}) =>
    callRoute(issueToken, { url: url("token"), json, origin: null, ...extra });

  it("issues a 90 day mobile token, shown once, without a cookie or Origin header", async () => {
    const user = await createTestUser({ username: "alice" });
    const before = Date.now();
    const r = await exchange({
      username: "Alice",
      password: user.password,
      deviceName: "Pixel",
      platform: "android",
    });
    expect(r.res.status).toBe(201);
    const body = r.body as {
      token: string;
      expiresAt: string;
      user: { id: string };
    };
    expect(body.token).toMatch(/^hw_[A-Za-z0-9_-]{43}$/);
    expect(body.user.id).toBe(user.id);
    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt - before).toBeGreaterThanOrEqual(
      MOBILE_TOKEN_LIFETIME_MS - 1000,
    );
    expect(expiresAt - before).toBeLessThanOrEqual(
      MOBILE_TOKEN_LIFETIME_MS + 5000,
    );
    expect(r.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);

    const verified = verifyToken(body.token);
    expect(verified?.token.kind).toBe("mobile");
    expect(verified?.token.scopes).toEqual([...MOBILE_TOKEN_SCOPES]);
    const row = ctx.db.select().from(apiTokens).get()!;
    expect(row.name).toBe("Pixel (android)");
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it("works as a bearer credential straight away", async () => {
    const user = await createTestUser({ username: "alice" });
    const r = await exchange({
      username: "alice",
      password: user.password,
      deviceName: "iPhone",
    });
    const who = await callRoute(me, {
      url: url("me"),
      bearer: (r.body as { token: string }).token,
    });
    expect(who.body).toMatchObject({ auth: "token", user: { id: user.id } });
  });

  it("answers bad credentials like login and issues nothing", async () => {
    const user = await createTestUser({ username: "alice" });
    const wrong = await exchange({
      username: "alice",
      password: "nope",
      deviceName: "Pixel",
    });
    const unknown = await exchange({
      username: "nobody",
      password: user.password,
      deviceName: "Pixel",
    });
    expect([wrong.res.status, code(wrong)]).toEqual([
      401,
      "invalid_credentials",
    ]);
    expect(unknown.body).toEqual(wrong.body);
    expect(ctx.db.select().from(apiTokens).all()).toHaveLength(0);
  });

  it("shares the failed-login budget with the browser login", async () => {
    const user = await createTestUser({ username: "alice" });
    for (let i = 0; i < 3; i++) {
      await callRoute(login, {
        url: url("login"),
        json: { username: "alice", password: "bad" },
      });
    }
    for (let i = 0; i < 2; i++)
      await exchange({ username: "alice", password: "bad", deviceName: "d" });
    const r = await exchange({
      username: "alice",
      password: user.password,
      deviceName: "d",
    });
    expect([r.res.status, code(r)]).toEqual([429, "rate_limited"]);
  });

  it("requires a device name and rejects unknown fields", async () => {
    const user = await createTestUser({ username: "alice" });
    expect(
      (await exchange({ username: "alice", password: user.password })).res
        .status,
    ).toBe(400);
    expect(
      (
        await exchange({
          username: "alice",
          password: user.password,
          deviceName: "d",
          scopes: ["admin"],
        })
      ).res.status,
    ).toBe(400);
  });

  it("still applies the browser CSRF rules when a session cookie rides along", async () => {
    const user = await createTestUser({ username: "alice" });
    const s = loginTestUser(user);
    const r = await exchange(
      { username: "alice", password: user.password, deviceName: "d" },
      { session: s.token, origin: "https://evil.example" },
    );
    expect([r.res.status, code(r)]).toEqual([403, "csrf_failed"]);
  });
});

describe("DELETE /api/v1/auth/token", () => {
  useTestDB();

  it("revokes the token that made the call, and only that one", async () => {
    const user = await createTestUser();
    const a = createTestToken(user);
    const b = createTestToken(user);
    const r = await callRoute(revokeToken, {
      url: url("token"),
      method: "DELETE",
      bearer: a.token,
    });
    expect(r.res.status).toBe(204);
    expect(verifyToken(a.token)).toBeNull();
    expect(verifyToken(b.token)).not.toBeNull();
    const again = await callRoute(revokeToken, {
      url: url("token"),
      method: "DELETE",
      bearer: a.token,
    });
    expect(again.res.status).toBe(401);
  });

  it("is for tokens only", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const cookie = await callRoute(revokeToken, {
      url: url("token"),
      method: "DELETE",
      session: s.token,
    });
    expect([cookie.res.status, code(cookie)]).toEqual([403, "forbidden"]);
    const anon = await callRoute(revokeToken, {
      url: url("token"),
      method: "DELETE",
    });
    expect([anon.res.status, code(anon)]).toEqual([401, "unauthenticated"]);
  });

  it("revoking a token does not end the owner's browser session", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const t = createTestToken(user);
    await callRoute(revokeToken, {
      url: url("token"),
      method: "DELETE",
      bearer: t.token,
    });
    expect(validateSessionToken(s.token)).not.toBeNull();
  });
});
