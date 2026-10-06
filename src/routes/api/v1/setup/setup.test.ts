import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "$lib/api/constants";
import { authEvents, users } from "$lib/server/db";
import { validateSessionToken } from "$lib/server/auth/sessions";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { GET, POST } from "./+server";

const body = {
  username: "Alice",
  displayName: "Alice Example",
  password: "a-long-enough-password",
  locale: "en",
};

describe("GET /api/v1/setup", () => {
  useTestDB();

  it("reports whether setup is still open", async () => {
    expect(
      (await callRoute(GET, { url: "http://localhost/api/v1/setup" })).body,
    ).toEqual({
      needsSetup: true,
    });
    await createTestUser();
    expect(
      (await callRoute(GET, { url: "http://localhost/api/v1/setup" })).body,
    ).toEqual({
      needsSetup: false,
    });
  });
});

describe("POST /api/v1/setup", () => {
  const ctx = useTestDB();
  const setup = (json: unknown = body, extra = {}) =>
    callRoute(POST, { url: "http://localhost/api/v1/setup", json, ...extra });

  it("creates the first admin, starts a session and sets the locale", async () => {
    const r = await setup();
    expect(r.res.status).toBe(201);
    expect(r.body).toEqual({
      user: {
        id: expect.any(String),
        username: "alice",
        displayName: "Alice Example",
        role: "admin",
        locale: "en",
      },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);

    const token = r.cookies.get(SESSION_COOKIE)!;
    expect(token).toBeTruthy();
    expect(r.cookies.options(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(validateSessionToken(token)?.user.username).toBe("alice");
    expect(r.cookies.get("PARAGLIDE_LOCALE")).toBe("en");
    const events = ctx.db.select().from(authEvents).all();
    expect(events.map((e) => e.type)).toEqual(["setup_completed"]);
  });

  it("is closed afterwards with 409 setup_complete and creates nothing", async () => {
    await setup();
    const again = await setup({ ...body, username: "mallory" });
    expect([
      again.res.status,
      (again.body as { error: { code: string } }).error.code,
    ]).toEqual([409, "setup_complete"]);
    expect(again.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(ctx.db.select().from(users).all()).toHaveLength(1);
  });

  it("is race-safe: concurrent attempts create exactly one admin", async () => {
    const results = await Promise.all([
      setup({ ...body, username: "one" }, { ip: "198.51.100.1" }),
      setup({ ...body, username: "two" }, { ip: "198.51.100.2" }),
      setup({ ...body, username: "three" }, { ip: "198.51.100.3" }),
    ]);
    expect(results.map((r) => r.res.status).sort()).toEqual([201, 409, 409]);
    expect(ctx.db.select().from(users).all()).toHaveLength(1);
  });

  it("validates the body", async () => {
    for (const bad of [
      { ...body, password: "short" },
      { ...body, username: "x" },
      { ...body, locale: "fr" },
      { ...body, displayName: "" },
      { username: "alice" },
      { ...body, role: "admin" },
    ]) {
      const r = await setup(bad);
      expect(r.res.status).toBe(400);
    }
    expect(ctx.db.select().from(users).all()).toHaveLength(0);
  });

  it("rejects cross-origin and origin-less posts (login CSRF)", async () => {
    const cross = await setup(body, { origin: "https://evil.example" });
    expect([
      cross.res.status,
      (cross.body as { error: { code: string } }).error.code,
    ]).toEqual([403, "csrf_failed"]);
    const none = await setup(body, { origin: null });
    expect(none.res.status).toBe(403);
    const form = await callRoute(POST, {
      url: "http://localhost/api/v1/setup",
      rawBody: "username=alice",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(form.res.status).toBe(403);
    expect(ctx.db.select().from(users).all()).toHaveLength(0);
  });
});
