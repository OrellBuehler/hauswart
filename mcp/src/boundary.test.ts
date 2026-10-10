import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const src = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    const isTest = /\.test\.ts$|test-harness\.ts$/.test(entry.name);
    return entry.name.endsWith(".ts") && !isTest ? [path] : [];
  });
}

describe("the MCP server only uses client-safe code", () => {
  it("imports from src/lib/api and src/lib/tasks/engine, never from the server or the app", () => {
    const allowed = [
      "../../src/lib/api/",
      "../../../src/lib/api/",
      "../../src/lib/tasks/engine",
      "../../../src/lib/tasks/engine",
      "../../src/lib/dates",
      "../../../src/lib/dates",
      "../../src/lib/money",
      "../../../src/lib/money",
      "../../src/lib/vehicles/",
      "../../../src/lib/vehicles/",
      "../../package.json",
    ];
    for (const file of sources(src)) {
      const text = readFileSync(file, "utf8");
      const specs = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const spec of specs.filter(
        (s) => s.includes("src/") || s.startsWith("$"),
      )) {
        expect(
          allowed.some((a) => spec.startsWith(a)),
          `${file} imports ${spec}`,
        ).toBe(true);
      }
    }
  });

  it("bundles without any server, database or SvelteKit module", async () => {
    const result = await Bun.build({
      entrypoints: [join(src, "index.ts")],
      target: "bun",
      packages: "external",
      metafile: true,
      throw: true,
    });
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    expect(inputs.length).toBeGreaterThan(10);
    const bundled = inputs.map((i) => join(root, i).replace(root + "/", ""));
    expect(bundled.filter((i) => i.includes("src/lib/server"))).toEqual([]);
    expect(bundled.filter((i) => i.includes("src/routes"))).toEqual([]);
    expect(bundled.filter((i) => i.includes("src/lib/testing"))).toEqual([]);
    expect(bundled.some((i) => i.includes("src/lib/api/registry"))).toBe(true);
    expect(bundled.some((i) => i.includes("src/lib/tasks/engine/types"))).toBe(
      true,
    );
  });
});

describe("the app serves the MCP server through one file", () => {
  it("only the HTTP handler imports from mcp/", () => {
    const appSources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return appSources(path);
        return /\.(ts|svelte)$/.test(entry.name) &&
          !/\.test\.ts$/.test(entry.name)
          ? [path]
          : [];
      });
    const importers = appSources(join(root, "src")).filter((file) =>
      /from "[./]*\/mcp\/src\//.test(readFileSync(file, "utf8")),
    );
    expect(importers.map((f) => f.replace(root + "/", ""))).toEqual([
      "src/lib/server/api/handlers/mcp.ts",
    ]);
  });
});
