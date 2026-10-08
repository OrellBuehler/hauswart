import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "$lib/api/constants";
import { getDB, sessions } from "$lib/server/db";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { createTestEvent } from "$lib/testing/event";
import { handle } from "./hooks.server";

async function renderedLang(headers: Record<string, string> = {}) {
  const event = createTestEvent({ url: "http://localhost/login", headers });
  let html = "";
  const resolve = async (
    _event: unknown,
    opts?: {
      transformPageChunk?: (input: {
        html: string;
        done: boolean;
      }) => string | undefined;
    },
  ) => {
    html =
      opts?.transformPageChunk?.({
        html: '<html lang="%lang%">',
        done: true,
      }) ?? "";
    return new Response("ok");
  };
  await handle({ event: event as never, resolve: resolve as never });
  return html;
}

async function renderedPage(url: string, html: string) {
  const event = createTestEvent({ url });
  let rendered = "";
  const resolve = async (
    _event: unknown,
    opts?: {
      transformPageChunk?: (input: {
        html: string;
        done: boolean;
      }) => string | undefined;
    },
  ) => {
    rendered = opts?.transformPageChunk?.({ html, done: true }) ?? "";
    return new Response("ok");
  };
  await handle({ event: event as never, resolve: resolve as never });
  return rendered;
}

describe("pages without JavaScript", () => {
  const page =
    '<head><script nonce="abc">document.title = "x";</script></head><body>%lang%</body>';

  it("lose the nonce-bound colour-mode script, which their CSP would block anyway", async () => {
    for (const path of ["/offline", "/g/sample-token"]) {
      expect(await renderedPage(`http://localhost${path}`, page), path).toBe(
        "<head></head><body>de</body>",
      );
    }
  });

  it("keep it everywhere else", async () => {
    for (const path of ["/login", "/setup"]) {
      expect(await renderedPage(`http://localhost${path}`, page), path).toBe(
        '<head><script nonce="abc">document.title = "x";</script></head><body>de</body>',
      );
    }
  });
});

describe("handle", () => {
  it("falls back to the base locale", async () => {
    expect(await renderedLang()).toBe('<html lang="de">');
  });

  it("uses the preferred browser language when no cookie is set", async () => {
    expect(await renderedLang({ "accept-language": "en" })).toBe(
      '<html lang="en">',
    );
  });

  it("prefers the locale cookie over the browser language", async () => {
    expect(
      await renderedLang({
        cookie: "PARAGLIDE_LOCALE=de",
        "accept-language": "en",
      }),
    ).toBe('<html lang="de">');
  });
});

describe("authentication gate", () => {
  useTestDB();

  async function run(
    url: string,
    opts: { headers?: Record<string, string>; session?: string } = {},
  ) {
    const event = createTestEvent({
      url,
      headers: opts.headers,
      cookies: opts.session ? { [SESSION_COOKIE]: opts.session } : undefined,
    });
    let resolved: typeof event | undefined;
    const resolve = async (e: unknown) => {
      resolved = e as typeof event;
      return new Response("page");
    };
    const res = await handle({
      event: event as never,
      resolve: resolve as never,
    });
    return { res, event, resolved };
  }

  it("redirects anonymous page requests to the login with a return path", async () => {
    await createTestUser();
    const { res, resolved } = await run("http://localhost/tasks?due=today");
    expect(resolved).toBeUndefined();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "/login?redirectTo=%2Ftasks%3Fdue%3Dtoday",
    );
  });

  it("sends everything to setup while there are no users", async () => {
    const { res } = await run("http://localhost/tasks");
    expect(res.headers.get("location")).toBe("/setup");
  });

  it("lets the public paths through without a user", async () => {
    for (const path of [
      "/login",
      "/setup",
      "/api/health",
      "/api/v1/health",
      "/api/v1/openapi.json",
      "/api/v1/setup",
      "/api/v1/auth/login",
      "/api/v1/auth/token",
      "/api/public/anything",
      "/g/abc",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline",
    ]) {
      const { resolved } = await run(`http://localhost${path}`);
      expect(resolved, path).toBeDefined();
    }
  });

  it("answers anonymous API requests with a 401 envelope", async () => {
    await createTestUser();
    const { res } = await run("http://localhost/api/v1/tokens");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({
      error: { code: "unauthenticated", message: "Authentication required" },
    });
    const legacy = await run("http://localhost/api/other");
    expect(legacy.res.status).toBe(401);
    expect(legacy.res.headers.get("www-authenticate")).toBeNull();
  });

  it("tells API clients that setup is required while there are no users", async () => {
    const { res } = await run("http://localhost/api/v1/tokens");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("setup_required");
  });

  it("resolves a session cookie into locals", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const { res, resolved } = await run("http://localhost/tasks", {
      session: s.token,
    });
    expect(res.status).toBe(200);
    expect(resolved?.locals).toMatchObject({
      user: { id: user.id },
      session: { id: s.session.id },
      token: null,
    });
  });

  it("clears a stale session cookie on the redirect it issues", async () => {
    await createTestUser();
    const { res } = await run("http://localhost/tasks", {
      session: "stale-token",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers.get("set-cookie")).toContain("1970");
    const api = await run("http://localhost/api/v1/tokens", {
      session: "stale-token",
    });
    expect(api.res.status).toBe(401);
    expect(api.res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  });

  it("honours a bearer token on /api/v1 paths only", async () => {
    const user = await createTestUser();
    const t = createTestToken(user, { kind: "mcp" });
    const headers = { authorization: `Bearer ${t.token}` };
    const v1 = await run("http://localhost/api/v1/auth/me", { headers });
    expect(v1.resolved?.locals).toMatchObject({
      user: { id: user.id },
      session: null,
      token: { id: t.record.id, kind: "mcp" },
    });
    const legacy = await run("http://localhost/api/other", { headers });
    expect(legacy.resolved).toBeUndefined();
    expect(legacy.res.status).toBe(401);
    const page = await run("http://localhost/tasks", { headers });
    expect(page.res.status).toBe(303);
  });

  it("does not fall back to the cookie when the bearer token is bad", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const { res } = await run("http://localhost/api/v1/auth/me", {
      session: s.token,
      headers: { authorization: "Bearer hw_wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("treats a bad bearer token on a public path as anonymous", async () => {
    const { resolved } = await run("http://localhost/api/v1/auth/token", {
      headers: { authorization: "Bearer hw_wrong" },
    });
    expect(resolved?.locals).toMatchObject({ user: null, token: null });
  });

  it("ignores other Authorization schemes (a proxy's basic auth) and uses the cookie", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    const { resolved } = await run("http://localhost/api/v1/auth/me", {
      session: s.token,
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(resolved?.locals.user).toMatchObject({ id: user.id });
  });

  it("refreshes a session that is close to expiry", async () => {
    const user = await createTestUser();
    const s = loginTestUser(user);
    expireSoon(s.session.id);
    const { event, res } = await run("http://localhost/tasks", {
      session: s.token,
    });
    expect(res.status).toBe(200);
    expect(event.cookies.get(SESSION_COOKIE)).toBe(s.token);
  });
});

function expireSoon(sessionId: string) {
  getDB()
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .where(eq(sessions.id, sessionId))
    .run();
}

describe("security headers", () => {
  useTestDB();

  const EXPECTED = {
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "permissions-policy": "camera=(self), geolocation=()",
  };

  async function headersOf(
    url: string,
    respond: () => Response | Promise<Response>,
    session?: string,
  ) {
    const event = createTestEvent({
      url,
      cookies: session ? { [SESSION_COOKIE]: session } : undefined,
    });
    const res = await handle({
      event: event as never,
      resolve: respond as never,
    });
    return res.headers;
  }

  it("are set on page responses", async () => {
    const user = await createTestUser();
    const headers = await headersOf(
      "http://localhost/tasks",
      () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
      loginTestUser(user).token,
    );
    for (const [name, value] of Object.entries(EXPECTED)) {
      expect(headers.get(name), name).toBe(value);
    }
  });

  it("are set on redirects, API errors and JSON responses too", async () => {
    for (const url of [
      "http://localhost/tasks",
      "http://localhost/api/v1/tokens",
      "http://localhost/api/health",
    ]) {
      const headers = await headersOf(url, () => new Response("{}"));
      for (const [name, value] of Object.entries(EXPECTED)) {
        expect(headers.get(name), `${url} ${name}`).toBe(value);
      }
    }
  });

  it("are set on responses whose headers are immutable", async () => {
    const headers = await headersOf("http://localhost/api/health", () =>
      Response.redirect("http://localhost/elsewhere", 302),
    );
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("location")).toBe("http://localhost/elsewhere");
  });

  it("do not override a header the response already sets", async () => {
    const headers = await headersOf(
      "http://localhost/api/health",
      () =>
        new Response("x", { headers: { "referrer-policy": "no-referrer" } }),
    );
    expect(headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("unexpected failures", () => {
  const ctx = useTestDB();
  afterEach(() => vi.restoreAllMocks());

  const failing = () => {
    throw new Error("sensitive detail: /srv/secret/path");
  };

  it("answer /api paths with the JSON error envelope and leak nothing", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = await createTestUser();
    const s = loginTestUser(user).token;
    for (const url of ["/api/v1/tokens", "/api/other"]) {
      const event = createTestEvent({
        url: `http://localhost${url}`,
        cookies: { [SESSION_COOKIE]: s },
      });
      const res = await handle({
        event: event as never,
        resolve: failing as never,
      });
      expect(res.status, url).toBe(500);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        error: { code: "internal", message: "Internal server error" },
      });
      expect(text).not.toContain("sensitive");
    }
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("hook.error");
    expect(logged).not.toContain("sensitive");
    error.mockRestore();
  });

  it("answer an API request whose authentication lookup fails the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await createTestUser();
    const s = loginTestUser(user).token;
    ctx.db.$client.close();
    const event = createTestEvent({
      url: "http://localhost/api/v1/tokens",
      cookies: { [SESSION_COOKIE]: s },
    });
    const res = await handle({
      event: event as never,
      resolve: (() => new Response("never")) as never,
    });
    expect([res.status, (await res.json()).error.code]).toEqual([
      500,
      "internal",
    ]);
  });

  it("leave page errors to SvelteKit", async () => {
    const user = await createTestUser();
    const event = createTestEvent({
      url: "http://localhost/tasks",
      cookies: { [SESSION_COOKIE]: loginTestUser(user).token },
    });
    await expect(
      Promise.resolve(
        handle({ event: event as never, resolve: failing as never }),
      ),
    ).rejects.toThrow("sensitive detail");
  });
});
