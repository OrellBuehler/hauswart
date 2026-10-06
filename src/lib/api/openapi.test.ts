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
      "Asset",
      "AssetContact",
      "AssetPart",
      "AssetSuggestion",
      "Attachment",
      "Comment",
      "Completion",
      "Contact",
      "ContactDetail",
      "ContactSuggestion",
      "CreatedApiToken",
      "Dashboard",
      "DashboardDefect",
      "DashboardPreparation",
      "DashboardTask",
      "DashboardWarranty",
      "Defect",
      "DefectDetail",
      "DefectEvent",
      "DefectTimelineItem",
      "DirectoryUser",
      "DocPage",
      "DocPageSummary",
      "DocumentLink",
      "DocumentLinkSummary",
      "DocumentUpload",
      "DueResult",
      "ErrorEnvelope",
      "ExternalCalendar",
      "ExternalCorrespondent",
      "ExternalCustomField",
      "ExternalDevice",
      "ExternalDocument",
      "ExternalDocumentDetail",
      "ExternalEntity",
      "ExternalGroup",
      "ExternalStoragePath",
      "ExternalTag",
      "GroupStats",
      "Heading",
      "Hint",
      "Household",
      "HouseholdSettings",
      "Integration",
      "IntegrationTest",
      "Notification",
      "NotificationActionResult",
      "NotificationParams",
      "NotificationSettings",
      "NotificationTarget",
      "OrderNowItem",
      "PageBacklink",
      "PageRevision",
      "PageRevisionSummary",
      "Part",
      "PartDetail",
      "PartMovement",
      "Preparation",
      "Room",
      "SearchHit",
      "ServiceLogEntry",
      "SignalReaction",
      "Stats",
      "Task",
      "TaskDetail",
      "TaskPart",
      "TaskState",
      "Trigger",
      "User",
      "Warranty",
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

  it("documents binary endpoints as files with their content types", () => {
    const content = doc.paths["/api/v1/attachments/{id}/content"].get as {
      responses: Record<string, { content?: Record<string, unknown> }>;
    };
    expect(Object.keys(content.responses["200"].content ?? {}).sort()).toEqual([
      "application/octet-stream",
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(content.responses["200"].content!["image/png"]).toEqual({
      schema: { type: "string", format: "binary" },
    });
    expect(content.responses["404"]).toBeDefined();
    const thumb = doc.paths["/api/v1/attachments/{id}/thumb"].get as {
      responses: Record<string, { content?: Record<string, unknown> }>;
    };
    expect(Object.keys(thumb.responses["200"].content ?? {})).toEqual([
      "image/webp",
    ]);
  });

  it("documents multipart uploads with a binary file field and the upload errors", () => {
    const upload = doc.paths["/api/v1/attachments"].post as {
      requestBody: {
        content: Record<
          string,
          { schema: { properties: Record<string, { format?: string }> } }
        >;
      };
      responses: Record<string, unknown>;
    };
    const schema = upload.requestBody.content["multipart/form-data"].schema;
    expect(schema.properties.file.format).toBe("binary");
    expect(Object.keys(upload.responses)).toEqual(
      expect.arrayContaining(["201", "400", "403", "413", "415"]),
    );
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

  it("documents PDF endpoints as application/pdf", () => {
    const op = doc.paths["/api/v1/defects/export.pdf"].get as {
      responses: Record<string, { content?: Record<string, unknown> }>;
    };
    expect(op.responses["200"].content).toEqual({
      "application/pdf": { schema: { type: "string", format: "binary" } },
    });
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

  it("lists setup_required on every endpoint the hook gates, and on none of the public ones", () => {
    for (const e of endpointList) {
      const codes = errorCodesFor(e);
      if (e.auth === "public")
        expect(codes, e.id).not.toContain("setup_required");
      else expect(codes, e.id).toContain("setup_required");
    }
    const logout = doc.paths["/api/v1/auth/logout"].post as {
      responses: Record<string, { description: string }>;
    };
    expect(logout.responses["401"].description).toContain("setup_required");
  });

  it("documents 413 and 415 for endpoints with a request body only", () => {
    for (const e of endpointList) {
      const op = doc.paths[e.path][e.method.toLowerCase()] as {
        responses: Record<string, { description: string }>;
      };
      if (e.body) {
        expect(op.responses["413"].description, e.id).toContain(
          "invalid_request",
        );
        expect(op.responses["415"].description, e.id).toContain(
          "invalid_request",
        );
      } else {
        expect(op.responses["413"], e.id).toBeUndefined();
        expect(op.responses["415"], e.id).toBeUndefined();
      }
    }
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
