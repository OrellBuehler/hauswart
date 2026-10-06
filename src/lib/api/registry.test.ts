import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  HTTP_METHODS,
  defineEndpoint,
  endpointList,
  endpoints,
  pathParamNames,
} from "./registry";
import { emptySchema, idParamsSchema } from "./schemas/common";
import type { CallInput } from "./client";

describe("registry", () => {
  it("keys endpoints by their id", () => {
    for (const [key, endpoint] of Object.entries(endpoints)) {
      expect(endpoint.id, key).toBe(key);
    }
    expect(endpointList).toHaveLength(Object.keys(endpoints).length);
  });

  it("has unique ids and unique method+path pairs", () => {
    const ids = endpointList.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = endpointList.map((e) => `${e.method} ${e.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("uses versioned paths and known methods", () => {
    for (const e of endpointList) {
      expect(e.path, e.id).toMatch(/^\/api\/v1\/[a-z0-9{}/.-]+$/);
      expect(HTTP_METHODS).toContain(e.method);
      expect(e.summary, e.id).not.toBe("");
      expect(e.tags.length, e.id).toBeGreaterThan(0);
    }
  });

  it("keeps path parameters and the params schema in step", () => {
    for (const e of endpointList) {
      expect(pathParamNames(e.path).sort(), e.id).toEqual(
        Object.keys(e.params?.shape ?? {}).sort(),
      );
    }
  });

  it("is consistent about auth, scopes and bodies", () => {
    for (const e of endpointList) {
      if (e.auth === "public") expect(e.scopes, e.id).toEqual([]);
      if (e.scopes.includes("admin")) expect(e.auth, e.id).not.toBe("public");
      if (e.method === "GET") expect(e.body, e.id).toBeUndefined();
      if (e.status === 204) expect(e.response, e.id).toBe(emptySchema);
      if (e.setsSession) expect(e.method, e.id).toBe("POST");
    }
  });

  it("registers the documented surface", () => {
    expect(
      endpointList.map((e) => `${e.method} ${e.path} ${e.auth}`).sort(),
    ).toEqual(
      [
        "GET /api/v1/health public",
        "GET /api/v1/openapi.json public",
        "GET /api/v1/setup public",
        "POST /api/v1/setup public",
        "POST /api/v1/auth/login public",
        "POST /api/v1/auth/logout session",
        "GET /api/v1/auth/me both",
        "PATCH /api/v1/auth/me session",
        "POST /api/v1/auth/token public",
        "DELETE /api/v1/auth/token bearer",
        "GET /api/v1/tokens session",
        "POST /api/v1/tokens session",
        "DELETE /api/v1/tokens/{id} session",
        "GET /api/v1/users session",
        "POST /api/v1/users session",
        "PATCH /api/v1/users/{id} session",
        "POST /api/v1/users/{id}/revoke-tokens session",
      ].sort(),
    );
  });
});

describe("defineEndpoint", () => {
  const base = {
    id: "thing",
    method: "GET",
    summary: "s",
    tags: ["t"],
    auth: "session",
    scopes: [],
    response: z.object({ ok: z.boolean() }),
  } as const;

  it("rejects paths outside /api/v1", () => {
    expect(() => defineEndpoint({ ...base, path: "/api/things" })).toThrow(
      /must start with/,
    );
  });

  it("rejects path parameters without a schema, and the reverse", () => {
    expect(() =>
      defineEndpoint({ ...base, path: "/api/v1/things/{id}" }),
    ).toThrow(/path parameters/);
    expect(() =>
      defineEndpoint({
        ...base,
        path: "/api/v1/things",
        params: idParamsSchema,
      }),
    ).toThrow(/path parameters/);
  });

  it("rejects bodies on GET and DELETE", () => {
    expect(() =>
      defineEndpoint({
        ...base,
        path: "/api/v1/things",
        body: z.object({}),
      }),
    ).toThrow(/cannot have a body/);
  });

  it("fills in defaults", () => {
    const e = defineEndpoint({ ...base, path: "/api/v1/things" });
    expect(e.status).toBe(200);
    expect(e.bodyType).toBe("json");
    expect(e.errors).toEqual([]);
    expect(e.setsSession).toBe(false);
  });
});

describe("typed call input", () => {
  it("requires params and body exactly where the schemas do", () => {
    expectTypeOf<CallInput<typeof endpoints.health>>().toEqualTypeOf<unknown>();
    expectTypeOf<CallInput<typeof endpoints.tokensRevoke>>().toEqualTypeOf<{
      params: { id: string };
    }>();
    expectTypeOf<CallInput<typeof endpoints.authLogin>>().toEqualTypeOf<{
      body: { username: string; password: string };
    }>();
  });
});
