import { beforeEach, describe, expect, it } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { SCOPES, scopesForRole, type Scope } from "$lib/api/scopes";
import { endpointList, type AnyEndpoint } from "$lib/api/registry";
import { isPublicPath } from "$lib/server/auth/routing";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
  type TestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { callRoute, type RouteResult } from "$lib/testing/route";

/**
 * Authorization inventory and matrix.
 *
 * Every route file (+server.ts, +page.server.ts, +layout.server.ts, +page.ts,
 * +layout.ts) is either listed in `legacy` with its access class or is an
 * `/api/v1` route, which is covered automatically from the registry below.
 * Adding a route file fails the inventory until it is listed.
 *
 *  - access "public": reachable without a login (listed deliberately; its
 *                     behaviour is tested in its own test file).
 *  - access "user" / "admin": every handler must refuse anonymous callers
 *                     (and members, for "admin"); `handlers` calls each load
 *                     or endpoint with a fake event.
 *
 * There is one household with a few users: domain data is shared by all of
 * them, so the matrix tests the other axes: anonymous callers, credential
 * kind (browser session vs API token), token scopes, member vs administrator
 * and cross-origin cookie requests. Per-user resources (tokens, sessions) get
 * a user-A-cannot-see-user-B test next to their routes.
 */
interface LegacyEntry {
  access: "public" | "user" | "admin";
  handlers?: Record<
    string,
    (mod: Record<string, unknown>, event: never) => unknown
  >;
}

const legacy: Record<string, LegacyEntry> = {
  "/src/routes/api/health/+server.ts": { access: "public" },
  "/src/routes/login/+page.server.ts": { access: "public" },
  "/src/routes/setup/+page.ts": { access: "public" },
};

const loaders = {
  ...import.meta.glob("/src/routes/**/+page.server.ts"),
  ...import.meta.glob("/src/routes/**/+layout.server.ts"),
  ...import.meta.glob("/src/routes/**/+page.ts"),
  ...import.meta.glob("/src/routes/**/+layout.ts"),
  ...import.meta.glob("/src/routes/**/+server.ts"),
} as Record<string, () => Promise<Record<string, unknown>>>;

const isV1 = (file: string) => file.startsWith("/src/routes/api/v1/");

describe("route inventory", () => {
  it("every route file is an /api/v1 route or listed in the matrix", () => {
    const unlisted = Object.keys(loaders).filter(
      (f) => !isV1(f) && !(f in legacy),
    );
    expect(unlisted, "add these routes to the matrix in authz.test.ts").toEqual(
      [],
    );
  });

  it("the matrix lists no files that no longer exist", () => {
    expect(Object.keys(legacy).filter((f) => !(f in loaders))).toEqual([]);
  });

  it("protected routes declare handlers", () => {
    for (const [file, entry] of Object.entries(legacy)) {
      if (entry.access !== "public") {
        expect(Object.keys(entry.handlers ?? {}), file).not.toHaveLength(0);
      }
    }
  });

  it("public API endpoints sit on paths the hook lets anonymous callers reach", () => {
    for (const e of endpointList) {
      if (e.auth === "public") expect(isPublicPath(e.path), e.id).toBe(true);
    }
  });
});

const routeFile = (e: AnyEndpoint) =>
  `/src/routes${e.path.replace(/\{(\w+)\}/g, "[$1]")}/+server.ts`;

const isBlocked = (r: RouteResult) =>
  r.res.status === 401 || r.res.status === 403;
const codeOf = (r: RouteResult) =>
  (r.body as { error?: { code?: string } })?.error?.code;

describe("/api/v1 authorization matrix", () => {
  useTestDB();

  let admin: TestUser;
  let member: TestUser;
  beforeEach(async () => {
    admin = await createTestUser({ role: "admin" });
    member = await createTestUser();
  });

  async function request(
    e: AnyEndpoint,
    who: {
      session?: string;
      bearer?: string;
      origin?: string | null;
      anonymous?: true;
    } = {},
  ) {
    const handler = (await loaders[routeFile(e)]())[e.method] as (
      event: RequestEvent,
    ) => Promise<Response>;
    const params = Object.fromEntries(
      (e.path.match(/\{(\w+)\}/g) ?? []).map((p) => [
        p.slice(1, -1),
        "sample-id",
      ]),
    );
    const url = `http://localhost${e.path.replace(/\{(\w+)\}/g, "sample-id")}`;
    return callRoute(handler, {
      url,
      method: e.method,
      params,
      session: who.session,
      bearer: who.bearer,
      origin: who.origin,
      ...(e.body ? { json: {} } : {}),
    });
  }

  const sessionOf = (u: TestUser) => loginTestUser(u).token;
  const tokenOf = (u: TestUser, scopes: readonly Scope[]) =>
    createTestToken(u, { scopes, kind: "mcp" }).token;
  const acceptsSession = (e: AnyEndpoint) =>
    e.auth === "session" || e.auth === "both";
  const acceptsBearer = (e: AnyEndpoint) =>
    e.auth === "bearer" || e.auth === "both";
  const table = endpointList.map((e) => [`${e.method} ${e.path}`, e] as const);

  it.each(
    table.filter(([, e]) => e.auth !== "public" && !isPublicPath(e.path)),
  )(
    "%s: the hook stops anonymous callers before the handler runs",
    async (_name, e) => {
      const r = await callRoute(
        () => {
          throw new Error("handler reached without authentication");
        },
        {
          url: `http://localhost${e.path.replace(/\{(\w+)\}/g, "sample-id")}`,
          method: e.method,
        },
      );
      expect([r.res.status, codeOf(r)]).toEqual([401, "unauthenticated"]);
    },
  );

  it("covers the registry", () => {
    expect(table.length).toBeGreaterThan(10);
  });

  it.each(table)(
    "%s: anonymous callers get 401 unless the endpoint is public",
    async (_name, e) => {
      const r = await request(e);
      if (e.auth === "public")
        expect(
          isBlocked(r),
          "public endpoint refused an anonymous caller",
        ).toBe(false);
      else expect([r.res.status, codeOf(r)]).toEqual([401, "unauthenticated"]);
    },
  );

  it.each(table.filter(([, e]) => e.auth !== "public"))(
    "%s: a stale or garbage credential is no better than none",
    async (_name, e) => {
      expect((await request(e, { session: "garbage" })).res.status).toBe(401);
      expect((await request(e, { bearer: "hw_garbage" })).res.status).toBe(401);
    },
  );

  it.each(table.filter(([, e]) => e.auth === "session"))(
    "%s: session-only endpoints refuse even a fully scoped API token with 403",
    async (_name, e) => {
      const r = await request(e, { bearer: tokenOf(admin, SCOPES) });
      expect([r.res.status, codeOf(r)]).toEqual([403, "forbidden"]);
    },
  );

  it.each(table.filter(([, e]) => e.auth === "bearer"))(
    "%s: token-only endpoints refuse a browser session with 403",
    async (_name, e) => {
      const r = await request(e, { session: sessionOf(admin) });
      expect([r.res.status, codeOf(r)]).toEqual([403, "forbidden"]);
    },
  );

  it.each(table.filter(([, e]) => e.auth !== "public"))(
    "%s: the right credential with the right role reaches the handler",
    async (_name, e) => {
      const who = acceptsSession(e)
        ? { session: sessionOf(admin) }
        : { bearer: tokenOf(admin, e.scopes) };
      expect(isBlocked(await request(e, who))).toBe(false);
    },
  );

  it.each(table.filter(([, e]) => e.scopes.length > 0 && acceptsSession(e)))(
    "%s: a member session is refused exactly when a scope is beyond the member role",
    async (_name, e) => {
      const needsAdmin = e.scopes.some(
        (s) => !scopesForRole("member").includes(s),
      );
      const r = await request(e, { session: sessionOf(member) });
      if (needsAdmin)
        expect([r.res.status, codeOf(r)]).toEqual([403, "forbidden"]);
      else expect(isBlocked(r)).toBe(false);
    },
  );

  it.each(table.filter(([, e]) => e.scopes.length > 0 && acceptsBearer(e)))(
    "%s: a token missing any required scope gets 403, one with them all gets through",
    async (_name, e) => {
      for (const missing of e.scopes) {
        const scopes = SCOPES.filter((s) => s !== missing);
        const r = await request(e, { bearer: tokenOf(admin, scopes) });
        expect([r.res.status, codeOf(r)], `without ${missing}`).toEqual([
          403,
          "forbidden",
        ]);
      }
      expect(
        isBlocked(await request(e, { bearer: tokenOf(admin, e.scopes) })),
      ).toBe(false);
    },
  );

  it.each(
    table.filter(([, e]) => e.scopes.includes("admin") && acceptsBearer(e)),
  )("%s: a member's token cannot carry the admin scope", async (_name, e) => {
    const r = await request(e, { bearer: tokenOf(member, SCOPES) });
    expect(r.res.status).toBe(403);
  });

  it.each(table.filter(([, e]) => e.scopes.length === 0 && acceptsBearer(e)))(
    "%s: needs no scope, so a token with none still works",
    async (_name, e) => {
      expect(isBlocked(await request(e, { bearer: tokenOf(member, []) }))).toBe(
        false,
      );
    },
  );

  it.each(table.filter(([, e]) => acceptsSession(e) && e.method !== "GET"))(
    "%s: cookie requests from another origin or without Origin get 403 csrf_failed",
    async (_name, e) => {
      const session = sessionOf(admin);
      const cross = await request(e, {
        session,
        origin: "https://evil.example",
      });
      expect([cross.res.status, codeOf(cross)]).toEqual([403, "csrf_failed"]);
      const none = await request(e, { session, origin: null });
      expect([none.res.status, codeOf(none)]).toEqual([403, "csrf_failed"]);
    },
  );

  it.each(table.filter(([, e]) => e.setsSession))(
    "%s: cookie-setting endpoints check the origin even for anonymous callers",
    async (_name, e) => {
      const cross = await request(e, { origin: "https://evil.example" });
      expect([cross.res.status, codeOf(cross)]).toEqual([403, "csrf_failed"]);
      expect(codeOf(await request(e, { origin: null }))).toBe("csrf_failed");
    },
  );

  it.each(table.filter(([, e]) => e.auth === "bearer" && e.method !== "GET"))(
    "%s: bearer requests need no Origin header",
    async (_name, e) => {
      const r = await request(e, {
        bearer: tokenOf(admin, e.scopes),
        origin: null,
      });
      expect(codeOf(r)).not.toBe("csrf_failed");
      expect(isBlocked(r)).toBe(false);
    },
  );
});
