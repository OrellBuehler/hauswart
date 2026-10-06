import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "$lib/api/openapi";
import { endpoints } from "$lib/api/registry";
import { useTestDB } from "$lib/testing/db";
import { callRoute } from "$lib/testing/route";
import { GET as health } from "./health/+server";
import { GET as openapi } from "./openapi.json/+server";

describe("GET /api/v1/health", () => {
  useTestDB();

  it("is public and reports status and version", async () => {
    const r = await callRoute(health, {
      url: "http://localhost/api/v1/health",
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", version: expect.any(String) });
  });
});

describe("GET /api/v1/openapi.json", () => {
  useTestDB();

  it("is public and serves the document built from the registry", async () => {
    const r = await callRoute(openapi, {
      url: "http://localhost/api/v1/openapi.json",
    });
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
    expect(Object.keys((r.body as { paths: object }).paths)).toContain(
      endpoints.authMe.path,
    );
  });
});
