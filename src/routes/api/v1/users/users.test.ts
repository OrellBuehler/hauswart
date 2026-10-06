import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE } from "$lib/api/constants";
import { authEvents, users } from "$lib/server/db";
import { validateSessionToken } from "$lib/server/auth/sessions";
import { verifyToken } from "$lib/server/auth/tokens";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { POST as login } from "../auth/login/+server";
import { PATCH } from "./[id]/+server";
import { GET, POST } from "./+server";

const list = (session?: string) =>
  callRoute(GET, { url: "http://localhost/api/v1/users", session });
const create = (session: string, json: unknown, extra = {}) =>
  callRoute(POST, {
    url: "http://localhost/api/v1/users",
    session,
    json,
    ...extra,
  });
const patch = (id: string, session: string, json: unknown, extra = {}) =>
  callRoute(PATCH, {
    url: `http://localhost/api/v1/users/${id}`,
    method: "PATCH",
    params: { id },
    session,
    json,
    ...extra,
  });
const code = (r: { body: unknown }) =>
  (r.body as { error: { code: string } }).error.code;

const newUser = {
  username: "Bob",
  displayName: "Bob Example",
  password: "a-long-enough-password",
};

describe("users API", () => {
  const ctx = useTestDB();

  it("lists all users for an administrator, without credentials", async () => {
    const admin = await createTestUser({
      username: "root",
      role: "admin",
      displayName: "Root",
    });
    await createTestUser({ username: "amy" });
    const r = await list(loginTestUser(admin).token);
    expect(r.res.status).toBe(200);
    const body = r.body as { items: { username: string }[]; nextCursor: null };
    expect(body.items.map((u) => u.username)).toEqual(["amy", "root"]);
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).toEqual({
      id: expect.any(String),
      username: "amy",
      displayName: null,
      role: "member",
      locale: "de",
      ownershipBps: 5000,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
  });

  it("creates a member by default, who can then log in", async () => {
    const admin = await createTestUser({ role: "admin" });
    const r = await create(loginTestUser(admin).token, newUser);
    expect(r.res.status).toBe(201);
    expect(r.body).toEqual({
      user: expect.objectContaining({
        username: "bob",
        role: "member",
        locale: "de",
        ownershipBps: 5000,
      }),
    });
    const loggedIn = await callRoute(login, {
      url: "http://localhost/api/v1/auth/login",
      json: { username: "bob", password: newUser.password },
    });
    expect(loggedIn.res.status).toBe(200);
    expect(
      ctx.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => e.type),
    ).toEqual(["user_created"]);
  });

  it("creates administrators and honours locale and cost share", async () => {
    const admin = await createTestUser({ role: "admin" });
    const r = await create(loginTestUser(admin).token, {
      ...newUser,
      role: "admin",
      locale: "en",
      ownershipBps: 3000,
    });
    expect(r.body).toMatchObject({
      user: { role: "admin", locale: "en", ownershipBps: 3000 },
    });
  });

  it("rejects duplicate usernames with 409 conflict and invalid bodies with 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    const s = loginTestUser(admin).token;
    await create(s, newUser);
    const dup = await create(s, { ...newUser, username: "BOB" });
    expect([dup.res.status, code(dup)]).toEqual([409, "conflict"]);
    for (const bad of [
      { ...newUser, username: "x" },
      { ...newUser, password: "short" },
      { ...newUser, role: "owner" },
      { ...newUser, displayName: undefined },
      { ...newUser, passwordHash: "x" },
    ]) {
      expect((await create(s, bad)).res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("updates role, name and cost share", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const r = await patch(member.id, loginTestUser(admin).token, {
      role: "admin",
      displayName: "Promoted",
      ownershipBps: 6000,
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({
      user: {
        id: member.id,
        role: "admin",
        displayName: "Promoted",
        ownershipBps: 6000,
      },
    });
    expect(
      ctx.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => e.type),
    ).toEqual(["role_changed"]);
  });

  it("resets a password: old one stops working, their sessions and device tokens end", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser({ username: "maya" });
    const memberSession = loginTestUser(member);
    const mobile = createTestToken(member, { kind: "mobile" });
    const mcp = createTestToken(member, { kind: "mcp" });
    const r = await patch(member.id, loginTestUser(admin).token, {
      password: "brand-new-password",
    });
    expect(r.res.status).toBe(200);
    expect(validateSessionToken(memberSession.token)).toBeNull();
    expect(verifyToken(mobile.token)).toBeNull();
    expect(verifyToken(mcp.token)).not.toBeNull();
    const oldLogin = await callRoute(login, {
      url: "http://localhost/api/v1/auth/login",
      json: { username: "maya", password: member.password },
    });
    expect(oldLogin.res.status).toBe(401);
    const newLogin = await callRoute(login, {
      url: "http://localhost/api/v1/auth/login",
      json: { username: "maya", password: "brand-new-password" },
    });
    expect(newLogin.res.status).toBe(200);
    expect(newLogin.cookies.get(SESSION_COOKIE)).toBeTruthy();
    expect(
      ctx.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => e.type),
    ).toEqual(["password_reset"]);
  });

  it("an administrator resetting their own password keeps their current session", async () => {
    const admin = await createTestUser({ role: "admin" });
    const s = loginTestUser(admin);
    const other = loginTestUser(admin);
    await patch(admin.id, s.token, { password: "brand-new-password" });
    expect(validateSessionToken(s.token)).not.toBeNull();
    expect(validateSessionToken(other.token)).toBeNull();
  });

  it("refuses to demote the last administrator", async () => {
    const admin = await createTestUser({ role: "admin" });
    const r = await patch(admin.id, loginTestUser(admin).token, {
      role: "member",
    });
    expect([r.res.status, code(r)]).toEqual([409, "conflict"]);
    expect(
      ctx.db.select().from(users).where(eq(users.id, admin.id)).get()?.role,
    ).toBe("admin");
  });

  it("answers 404 for unknown users and 400 for empty or foreign fields", async () => {
    const admin = await createTestUser({ role: "admin" });
    const s = loginTestUser(admin).token;
    expect((await patch("nope", s, { displayName: "x" })).res.status).toBe(404);
    expect((await patch(admin.id, s, {})).res.status).toBe(400);
    expect((await patch(admin.id, s, { username: "other" })).res.status).toBe(
      400,
    );
    expect((await patch(admin.id, s, { ownershipBps: 10001 })).res.status).toBe(
      400,
    );
  });

  describe("access", () => {
    it("members are refused everywhere with 403, anonymous callers with 401", async () => {
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      const s = loginTestUser(member).token;
      expect((await list(s)).res.status).toBe(403);
      expect((await create(s, newUser)).res.status).toBe(403);
      expect((await patch(admin.id, s, { role: "member" })).res.status).toBe(
        403,
      );
      expect((await patch(member.id, s, { role: "admin" })).res.status).toBe(
        403,
      );
      expect(
        ctx.db.select().from(users).where(eq(users.id, member.id)).get()?.role,
      ).toBe("member");
      expect((await list()).res.status).toBe(401);
    });

    it("a member's token cannot reach admin endpoints even when it claims the admin scope", async () => {
      const member = await createTestUser();
      const t = createTestToken(member, {
        scopes: ["read", "admin"],
        kind: "mcp",
      });
      const r = await callRoute(GET, {
        url: "http://localhost/api/v1/users",
        bearer: t.token,
      });
      expect(r.res.status).toBe(403);
    });

    it("even an admin's token is refused on the session-only user endpoints", async () => {
      const admin = await createTestUser({ role: "admin" });
      const t = createTestToken(admin, {
        scopes: ["read", "admin"],
        kind: "mcp",
      });
      const r = await callRoute(GET, {
        url: "http://localhost/api/v1/users",
        bearer: t.token,
      });
      expect(r.res.status).toBe(403);
    });

    it("is protected against cross-site requests", async () => {
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      const s = loginTestUser(admin).token;
      const cross = await create(s, newUser, {
        origin: "https://evil.example",
      });
      expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
      const crossPatch = await patch(
        member.id,
        s,
        { role: "admin" },
        { origin: "https://evil.example" },
      );
      expect(crossPatch.res.status).toBe(403);
      expect(ctx.db.select().from(users).all()).toHaveLength(2);
    });
  });
});
