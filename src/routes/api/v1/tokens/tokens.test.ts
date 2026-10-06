import { describe, expect, it } from "vitest";
import { apiTokens, authEvents } from "$lib/server/db";
import { verifyToken } from "$lib/server/auth/tokens";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { GET as me } from "../auth/me/+server";
import { DELETE } from "./[id]/+server";
import { GET, POST } from "./+server";

const list = (session: string) =>
  callRoute(GET, { url: "http://localhost/api/v1/tokens", session });
const create = (session: string, json: unknown, extra = {}) =>
  callRoute(POST, {
    url: "http://localhost/api/v1/tokens",
    session,
    json,
    ...extra,
  });
const revoke = (id: string, session: string, extra = {}) =>
  callRoute(DELETE, {
    url: `http://localhost/api/v1/tokens/${id}`,
    method: "DELETE",
    params: { id },
    session,
    ...extra,
  });
const code = (r: { body: unknown }) =>
  (r.body as { error: { code: string } }).error.code;

describe("API tokens", () => {
  const ctx = useTestDB();

  it("creates a token whose plaintext is shown once and which then works as a bearer credential", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const r = await create(s.token, {
      name: "dashboard",
      kind: "ha",
      scopes: ["read", "ha:action"],
    });
    expect(r.res.status).toBe(201);
    const created = r.body as {
      token: string;
      id: string;
      prefix: string;
      scopes: string[];
    };
    expect(created.token).toMatch(/^hw_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 8));
    expect(created.scopes).toEqual(["read", "ha:action"]);

    const listed = await list(s.token);
    expect(JSON.stringify(listed.body)).not.toContain(created.token);
    expect(listed.body).toEqual({
      items: [
        {
          id: created.id,
          kind: "ha",
          name: "dashboard",
          prefix: created.prefix,
          scopes: ["read", "ha:action"],
          lastUsedAt: null,
          expiresAt: null,
          createdAt: expect.any(String),
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(listed.body)).not.toMatch(/hash/i);

    const who = await callRoute(me, {
      url: "http://localhost/api/v1/auth/me",
      bearer: created.token,
    });
    expect(who.body).toMatchObject({
      auth: "token",
      scopes: ["read", "ha:action"],
    });
    expect(
      ctx.db
        .select()
        .from(authEvents)
        .all()
        .map((e) => e.type),
    ).toEqual(["token_created"]);
  });

  it("stores an optional expiry and rejects past ones", async () => {
    const s = loginTestUser(await createTestUser());
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const ok = await create(s.token, {
      name: "n",
      kind: "mcp",
      scopes: ["read"],
      expiresAt: future,
    });
    expect((ok.body as { expiresAt: string }).expiresAt).toBe(future);
    const past = await create(s.token, {
      name: "n",
      kind: "mcp",
      scopes: ["read"],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect([past.res.status, code(past)]).toEqual([400, "invalid_request"]);
  });

  it("never grants more than the creator holds", async () => {
    const member = await createTestUser();
    const admin = await createTestUser({ role: "admin" });
    const denied = await create(loginTestUser(member).token, {
      name: "n",
      kind: "integration",
      scopes: ["read", "admin"],
    });
    expect([denied.res.status, code(denied)]).toEqual([403, "forbidden"]);
    expect(ctx.db.select().from(apiTokens).all()).toHaveLength(0);
    const granted = await create(loginTestUser(admin).token, {
      name: "n",
      kind: "integration",
      scopes: ["admin"],
    });
    expect(granted.res.status).toBe(201);
  });

  it("validates the body: no mobile tokens, no empty or unknown scopes, no extra fields", async () => {
    const s = loginTestUser(await createTestUser());
    for (const json of [
      { name: "n", kind: "mobile", scopes: ["read"] },
      { name: "n", kind: "ha", scopes: [] },
      { name: "n", kind: "ha", scopes: ["root"] },
      { name: "", kind: "ha", scopes: ["read"] },
      { name: "n", kind: "ha", scopes: ["read"], userId: "x" },
      { kind: "ha", scopes: ["read"] },
    ]) {
      expect(
        (await create(s.token, json)).res.status,
        JSON.stringify(json),
      ).toBe(400);
    }
  });

  it("revokes a token, which then stops working", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const t = createTestToken(user, { kind: "mcp" });
    expect(verifyToken(t.token)).not.toBeNull();
    const r = await revoke(t.record.id, s.token);
    expect(r.res.status).toBe(204);
    expect(verifyToken(t.token)).toBeNull();
    expect((await list(s.token)).body).toEqual({ items: [], nextCursor: null });
    expect((await revoke(t.record.id, s.token)).res.status).toBe(404);
  });

  describe("per-user invisibility", () => {
    it("user A cannot list user B's tokens", async () => {
      const a = await createTestUser();
      const b = await createTestUser();
      createTestToken(a, { name: "mine" });
      createTestToken(b, { name: "theirs", kind: "mcp" });
      const items = (
        (await list(loginTestUser(a).token)).body as {
          items: { name: string }[];
        }
      ).items;
      expect(items.map((i) => i.name)).toEqual(["mine"]);
    });

    it("user A cannot revoke user B's token and sees it as not found", async () => {
      const a = await createTestUser();
      const b = await createTestUser();
      const theirs = createTestToken(b, { kind: "mcp" });
      const r = await revoke(theirs.record.id, loginTestUser(a).token);
      expect([r.res.status, code(r)]).toEqual([404, "not_found"]);
      expect(verifyToken(theirs.token)).not.toBeNull();
      const missing = await revoke("does-not-exist", loginTestUser(a).token);
      expect(missing.body).toEqual(r.body);
    });

    it("even an administrator only sees and revokes their own tokens", async () => {
      const admin = await createTestUser({ role: "admin" });
      const member = await createTestUser();
      const theirs = createTestToken(member);
      const s = loginTestUser(admin).token;
      expect(((await list(s)).body as { items: unknown[] }).items).toEqual([]);
      expect((await revoke(theirs.record.id, s)).res.status).toBe(404);
      expect(verifyToken(theirs.token)).not.toBeNull();
    });
  });

  describe("access", () => {
    it("needs a browser session: anonymous 401, token 403", async () => {
      const user = await createTestUser();
      const t = createTestToken(user, {
        kind: "mcp",
        scopes: ["read", "write", "admin"],
      });
      expect(
        (await callRoute(GET, { url: "http://localhost/api/v1/tokens" })).res
          .status,
      ).toBe(401);
      for (const handler of [
        () =>
          callRoute(GET, {
            url: "http://localhost/api/v1/tokens",
            bearer: t.token,
          }),
        () =>
          callRoute(POST, {
            url: "http://localhost/api/v1/tokens",
            bearer: t.token,
            json: { name: "n", kind: "mcp", scopes: ["read"] },
          }),
        () =>
          callRoute(DELETE, {
            url: `http://localhost/api/v1/tokens/${t.record.id}`,
            method: "DELETE",
            params: { id: t.record.id },
            bearer: t.token,
          }),
      ]) {
        expect((await handler()).res.status).toBe(403);
      }
      expect(verifyToken(t.token)).not.toBeNull();
    });

    it("is protected against cross-site requests", async () => {
      const user = await createTestUser();
      const s = loginTestUser(user);
      const t = createTestToken(user);
      const cross = await create(
        s.token,
        { name: "n", kind: "mcp", scopes: ["read"] },
        { origin: "https://evil.example" },
      );
      expect([cross.res.status, code(cross)]).toEqual([403, "csrf_failed"]);
      const del = await revoke(t.record.id, s.token, {
        origin: "https://evil.example",
      });
      expect([del.res.status, code(del)]).toEqual([403, "csrf_failed"]);
      expect(verifyToken(t.token)).not.toBeNull();
      expect(ctx.db.select().from(apiTokens).all()).toHaveLength(1);
    });
  });
});
