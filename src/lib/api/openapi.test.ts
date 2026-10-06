import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildOpenApiDocument,
  errorCodesFor,
  serializeOpenApiDocument,
} from "./openapi";
import { defineEndpoint, endpointList, endpoints } from "./registry";
import { userSchema } from "./schemas/auth";

type Doc = ReturnType<typeof buildOpenApiDocument> & {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
};

const doc = buildOpenApiDocument() as Doc;

describe("openapi document", () => {
  it("is OpenAPI 3.1 with both security schemes", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes).toMatchObject({
      cookieAuth: { type: "apiKey", in: "cookie", name: "hauswart_session" },
      bearerAuth: { type: "http", scheme: "bearer" },
    });
  });

  it("documents every endpoint under its path and method", () => {
    for (const e of endpointList) {
      const op = doc.paths[e.path]?.[e.method.toLowerCase()];
      expect(op, e.id).toBeDefined();
      expect(op.operationId).toBe(e.id);
    }
  });

  it("maps auth modes to security requirements", () => {
    const sec = (id: keyof typeof endpoints) => {
      const e = endpoints[id];
      return doc.paths[e.path][e.method.toLowerCase()].security;
    };
    expect(sec("health")).toEqual([]);
    expect(sec("tokensList")).toEqual([{ cookieAuth: [] }]);
    expect(sec("authRevokeToken")).toEqual([{ bearerAuth: [] }]);
    expect(sec("authMe")).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
    expect(sec("usersList")).toEqual([{ cookieAuth: [] }]);
    expect(doc.paths["/api/v1/users"].get["x-required-scopes"]).toEqual([
      "admin",
    ]);
  });

  it("hoists named schemas into components and references them", () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual([
      "AdminUser",
      "ApiToken",
      "CreatedApiToken",
      "ErrorEnvelope",
      "User",
    ]);
    const login = doc.paths["/api/v1/auth/login"].post as {
      responses: Record<
        string,
        { content: Record<string, { schema: unknown }> }
      >;
    };
    expect(
      login.responses["200"].content["application/json"].schema,
    ).toMatchObject({
      type: "object",
      properties: { user: { $ref: "#/components/schemas/User" } },
    });
    expect(JSON.stringify(doc)).not.toContain("#/$defs/");
  });

  it("documents params, query and request bodies", () => {
    const revoke = doc.paths["/api/v1/tokens/{id}"].delete as {
      parameters: { name: string; in: string; required: boolean }[];
    };
    expect(revoke.parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true }),
    ]);
    const token = doc.paths["/api/v1/auth/token"].post as {
      requestBody: { required: boolean; content: Record<string, unknown> };
    };
    expect(token.requestBody.required).toBe(true);
    expect(Object.keys(token.requestBody.content)).toEqual([
      "application/json",
    ]);

    const listing = defineEndpoint({
      id: "thingsList",
      method: "GET",
      path: "/api/v1/things",
      summary: "list",
      tags: ["things"],
      auth: "bearer",
      scopes: ["read"],
      query: z.object({ limit: z.coerce.number().default(5), q: z.string() }),
      response: z.object({ user: userSchema }),
    });
    const small = buildOpenApiDocument([listing]) as Doc;
    const op = small.paths["/api/v1/things"].get as {
      parameters: { name: string; in: string; required: boolean }[];
      security: unknown;
    };
    expect(op.parameters).toEqual([
      expect.objectContaining({ name: "limit", in: "query", required: false }),
      expect.objectContaining({ name: "q", in: "query", required: true }),
    ]);
    expect(op.security).toEqual([{ bearerAuth: ["read"] }]);
  });

  it("documents multipart bodies", () => {
    const upload = defineEndpoint({
      id: "upload",
      method: "POST",
      path: "/api/v1/uploads",
      summary: "upload",
      tags: ["files"],
      auth: "session",
      scopes: ["docs:write"],
      bodyType: "multipart",
      body: z.object({ file: z.file() }),
      response: z.object({ id: z.string() }),
      status: 201,
    });
    const small = buildOpenApiDocument([upload]) as Doc;
    const op = small.paths["/api/v1/uploads"].post as {
      requestBody: { content: Record<string, unknown> };
    };
    expect(Object.keys(op.requestBody.content)).toEqual([
      "multipart/form-data",
    ]);
  });

  it("documents 204 as bodiless and errors with the envelope", () => {
    const logout = doc.paths["/api/v1/auth/logout"].post as {
      responses: Record<string, { content?: unknown; description: string }>;
    };
    expect(logout.responses["204"]).toEqual({ description: "No content" });
    expect(logout.responses["401"].description).toContain("unauthenticated");
    expect(logout.responses["403"].description).toContain("csrf_failed");
    expect(logout.responses["500"].description).toContain("internal");
  });

  it("derives error codes from the endpoint shape", () => {
    expect(errorCodesFor(endpoints.health).sort()).toEqual(["internal"]);
    expect(errorCodesFor(endpoints.authLogin).sort()).toEqual(
      [
        "csrf_failed",
        "internal",
        "invalid_credentials",
        "invalid_request",
        "rate_limited",
      ].sort(),
    );
    expect(errorCodesFor(endpoints.tokensRevoke)).toContain("not_found");
  });

  it("rejects a named schema that renders differently as input and output", () => {
    const named = z.object({ n: z.coerce.number() }).meta({ id: "Clash" });
    const clash = defineEndpoint({
      id: "clash",
      method: "POST",
      path: "/api/v1/clash",
      summary: "x",
      tags: ["x"],
      auth: "session",
      scopes: [],
      body: z.object({ a: named }),
      response: z.object({ a: named }),
    });
    expect(() => buildOpenApiDocument([clash])).toThrow(/Clash/);
  });
});

describe("docs/openapi.json", () => {
  it("is up to date: run `bun run openapi` after changing the registry", () => {
    const committed = readFileSync(
      join(process.cwd(), "docs", "openapi.json"),
      "utf8",
    );
    expect(committed).toBe(serializeOpenApiDocument(buildOpenApiDocument()));
  });
});
