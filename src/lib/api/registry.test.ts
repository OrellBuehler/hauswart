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
      expect(e.path, e.id).toMatch(
        /^\/api\/v1(\/([a-z0-9.-]+|\{[A-Za-z0-9]+\}))+$/,
      );
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
        "GET /api/v1/rooms both",
        "POST /api/v1/rooms both",
        "GET /api/v1/rooms/{id} both",
        "PATCH /api/v1/rooms/{id} both",
        "DELETE /api/v1/rooms/{id} both",
        "GET /api/v1/assets both",
        "POST /api/v1/assets both",
        "GET /api/v1/assets/by-qr/{qrSlug} both",
        "GET /api/v1/assets/{id} both",
        "PATCH /api/v1/assets/{id} both",
        "DELETE /api/v1/assets/{id} both",
        "GET /api/v1/tasks both",
        "POST /api/v1/tasks both",
        "POST /api/v1/tasks/preview both",
        "GET /api/v1/tasks/{id} both",
        "PATCH /api/v1/tasks/{id} both",
        "DELETE /api/v1/tasks/{id} both",
        "POST /api/v1/tasks/{id}/complete both",
        "POST /api/v1/tasks/{id}/skip both",
        "POST /api/v1/tasks/{id}/snooze both",
        "GET /api/v1/tasks/{id}/preparations both",
        "POST /api/v1/tasks/{id}/preparations both",
        "PATCH /api/v1/tasks/{id}/preparations/{prepId} both",
        "DELETE /api/v1/tasks/{id}/preparations/{prepId} both",
        "POST /api/v1/tasks/{id}/preparations/{prepId}/complete both",
        "GET /api/v1/completions both",
        "DELETE /api/v1/completions/{id} both",
        "GET /api/v1/dashboard both",
        "GET /api/v1/stats both",
        "GET /api/v1/notifications both",
        "GET /api/v1/notifications/unread-count both",
        "POST /api/v1/notifications/read-all both",
        "POST /api/v1/notifications/{id}/read both",
        "GET /api/v1/household both",
        "PATCH /api/v1/household both",
        "GET /api/v1/users/directory both",
        "POST /api/v1/users/{id}/revoke-tokens session",
        "GET /api/v1/pages both",
        "POST /api/v1/pages both",
        "POST /api/v1/pages/preview both",
        "GET /api/v1/pages/{slug} both",
        "PATCH /api/v1/pages/{slug} both",
        "DELETE /api/v1/pages/{slug} both",
        "GET /api/v1/pages/{slug}/revisions both",
        "GET /api/v1/pages/{slug}/revisions/{rev} both",
        "POST /api/v1/pages/{slug}/revisions/{rev}/restore both",
        "GET /api/v1/search both",
        "POST /api/v1/attachments both",
        "GET /api/v1/attachments both",
        "GET /api/v1/attachments/{id} both",
        "PATCH /api/v1/attachments/{id} both",
        "DELETE /api/v1/attachments/{id} both",
        "GET /api/v1/attachments/{id}/content both",
        "GET /api/v1/attachments/{id}/thumb both",
        "GET /api/v1/contacts both",
        "POST /api/v1/contacts both",
        "GET /api/v1/contacts/{id} both",
        "PATCH /api/v1/contacts/{id} both",
        "DELETE /api/v1/contacts/{id} both",
        "GET /api/v1/assets/{id}/contacts both",
        "POST /api/v1/assets/{id}/contacts both",
        "DELETE /api/v1/assets/{id}/contacts/{linkId} both",
        "GET /api/v1/parts both",
        "POST /api/v1/parts both",
        "GET /api/v1/parts/order-now both",
        "GET /api/v1/parts/{id} both",
        "PATCH /api/v1/parts/{id} both",
        "DELETE /api/v1/parts/{id} both",
        "POST /api/v1/parts/{id}/stock both",
        "GET /api/v1/parts/{id}/movements both",
        "POST /api/v1/parts/{id}/ordered both",
        "GET /api/v1/assets/{id}/parts both",
        "POST /api/v1/assets/{id}/parts both",
        "DELETE /api/v1/assets/{id}/parts/{partId} both",
        "GET /api/v1/tasks/{id}/parts both",
        "POST /api/v1/tasks/{id}/parts both",
        "PATCH /api/v1/tasks/{id}/parts/{partId} both",
        "DELETE /api/v1/tasks/{id}/parts/{partId} both",
        "GET /api/v1/service-log both",
        "GET /api/v1/assets/{id}/service-log both",
        "POST /api/v1/assets/{id}/service-log both",
        "GET /api/v1/assets/{id}/service-log/{entryId} both",
        "PATCH /api/v1/assets/{id}/service-log/{entryId} both",
        "DELETE /api/v1/assets/{id}/service-log/{entryId} both",
        "GET /api/v1/defects both",
        "POST /api/v1/defects both",
        "GET /api/v1/defects/export.pdf both",
        "GET /api/v1/defects/{id} both",
        "PATCH /api/v1/defects/{id} both",
        "DELETE /api/v1/defects/{id} both",
        "POST /api/v1/defects/{id}/status both",
        "POST /api/v1/defects/{id}/events both",
        "GET /api/v1/defects/{id}/timeline both",
        "GET /api/v1/warranties both",
        "GET /api/v1/comments both",
        "POST /api/v1/comments both",
        "PATCH /api/v1/comments/{id} both",
        "DELETE /api/v1/comments/{id} both",
        "GET /api/v1/assets/{id}/hints both",
        "POST /api/v1/assets/{id}/hints both",
        "GET /api/v1/hints both",
        "GET /api/v1/hints/{id} both",
        "PATCH /api/v1/hints/{id} both",
        "DELETE /api/v1/hints/{id} both",
        "GET /api/v1/me/notification-settings both",
        "PUT /api/v1/me/notification-settings both",
        "GET /api/v1/integrations both",
        "PUT /api/v1/integrations/{kind} both",
        "DELETE /api/v1/integrations/{kind} both",
        "POST /api/v1/integrations/{kind}/test both",
        "GET /api/v1/integrations/{kind}/entities both",
        "GET /api/v1/integrations/{kind}/notify-services both",
        "GET /api/v1/integrations/{kind}/calendars both",
        "GET /api/v1/integrations/{kind}/devices both",
        "GET /api/v1/integrations/{kind}/tags both",
        "GET /api/v1/integrations/{kind}/correspondents both",
        "GET /api/v1/integrations/{kind}/custom-fields both",
        "GET /api/v1/integrations/{kind}/groups both",
        "GET /api/v1/integrations/{kind}/storage-paths both",
        "GET /api/v1/documents both",
        "GET /api/v1/documents/suggestions both",
        "GET /api/v1/documents/uploads/{jobId} both",
        "GET /api/v1/documents/{provider}/{externalId} both",
        "GET /api/v1/documents/{provider}/{externalId}/preview both",
        "GET /api/v1/documents/{provider}/{externalId}/thumb both",
        "GET /api/v1/documents/{provider}/{externalId}/download both",
        "GET /api/v1/document-links both",
        "POST /api/v1/document-links both",
        "DELETE /api/v1/document-links/{id} both",
        "POST /api/v1/attachments/{id}/push-to-documents both",
        "POST /api/v1/ha/action bearer",
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

  it("binary endpoints must be GET and list their content types", () => {
    const binary = {
      ...base,
      path: "/api/v1/things",
      responseType: "binary",
    } as const;
    expect(() => defineEndpoint(binary)).toThrow(/must list contentTypes/);
    expect(() =>
      defineEndpoint({
        ...binary,
        method: "POST",
        contentTypes: ["image/png"],
      }),
    ).toThrow(/must be GET/);
    const e = defineEndpoint({ ...binary, contentTypes: ["image/png"] });
    expect(e.responseType).toBe("binary");
    expect(e.contentTypes).toEqual(["image/png"]);
  });

  it("fills in defaults", () => {
    const e = defineEndpoint({ ...base, path: "/api/v1/things" });
    expect(e.responseType).toBe("json");
    expect(e.contentTypes).toEqual([]);
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
