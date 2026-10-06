import { describe, expect, it } from "vitest";
import {
  endpointList,
  HTTP_METHODS,
  type AnyEndpoint,
} from "$lib/api/registry";

type RouteModule = Record<string, unknown>;
type Bound = { endpoint?: AnyEndpoint };

const modules = import.meta.glob<RouteModule>(
  "/src/routes/api/v1/**/+server.ts",
  {
    eager: true,
  },
);
const sources = import.meta.glob<string>("/src/routes/api/v1/**/+server.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});
const allApiRoutes = Object.keys(
  import.meta.glob("/src/routes/api/**/+server.ts"),
);

function expectedPath(file: string): string {
  return file
    .replace("/src/routes", "")
    .replace(/\/\+server\.ts$/, "")
    .replace(/\[([A-Za-z0-9_]+)\]/g, "{$1}");
}

describe("api route guard", () => {
  it("finds the route files", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(modules))(
    "%s exports only bound handlers that match its location",
    (file, mod) => {
      const exported = Object.keys(mod);
      expect(exported.length, "route file exports nothing").toBeGreaterThan(0);
      const path = expectedPath(file);
      expect(path, "unsupported route syntax").toMatch(
        /^\/api\/v1(\/[A-Za-z0-9.{}_-]+)*$/,
      );
      for (const name of exported) {
        expect(
          HTTP_METHODS as readonly string[],
          `${name} is not an HTTP method export`,
        ).toContain(name);
        const endpoint = (mod[name] as Bound).endpoint;
        expect(endpoint, `${name} was not created by bind()`).toBeDefined();
        expect(endpointList, `${name} is not a registered endpoint`).toContain(
          endpoint,
        );
        expect(
          endpoint!.method,
          `${name} handler is bound to another method`,
        ).toBe(name);
        expect(endpoint!.path, `${name} is bound to another path`).toBe(path);
      }
    },
  );

  it("has a route file for every registry entry", () => {
    for (const endpoint of endpointList) {
      const found = Object.entries(modules).find(
        ([file, mod]) =>
          expectedPath(file) === endpoint.path &&
          (mod[endpoint.method] as Bound | undefined)?.endpoint === endpoint,
      );
      expect(
        found,
        `no route exports ${endpoint.method} ${endpoint.path}`,
      ).toBeDefined();
    }
  });

  it("binds each registry entry exactly once", () => {
    const bound = Object.values(modules).flatMap((mod) =>
      Object.values(mod).map((handler) => (handler as Bound).endpoint?.id),
    );
    expect(bound.sort()).toEqual(endpointList.map((e) => e.id).sort());
  });

  it.each(Object.entries(sources))(
    "%s is a one-liner route (imports and bind exports only)",
    (file, source) => {
      const withoutImports = source
        .replace(/^import[\s\S]*?;\s*$/gm, "")
        .trim();
      const lines = withoutImports.split("\n").filter((l) => l.trim() !== "");
      expect(lines.length, file).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, file).toMatch(
          /^export const (GET|POST|PUT|PATCH|DELETE) = bind\(endpoints\.[A-Za-z0-9]+, [A-Za-z0-9]+\);$/,
        );
      }
    },
  );

  it("keeps unversioned API routes to the liveness probe and public hooks", () => {
    const stray = allApiRoutes.filter(
      (f) =>
        !f.startsWith("/src/routes/api/v1/") &&
        f !== "/src/routes/api/health/+server.ts" &&
        !f.startsWith("/src/routes/api/public/"),
    );
    expect(
      stray,
      "domain endpoints belong under /api/v1 and the registry",
    ).toEqual([]);
  });
});
