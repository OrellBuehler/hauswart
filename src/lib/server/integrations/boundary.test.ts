import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|svelte|js)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join("/");

/**
 * Route directories that belong to an integration (for example an
 * unauthenticated webhook under `routes/api/public/<name>/` or a settings
 * page). Add a prefix here together with the adapter that needs it.
 */
const ALLOWED_ROUTE_PREFIXES: string[] = [];

/** Files that belong to an integration or may wire it in. */
function mayImportIntegrations(path: string): boolean {
  return (
    path.startsWith("lib/server/integrations/") ||
    ALLOWED_ROUTE_PREFIXES.some((p) => path.startsWith(p)) ||
    path === "hooks.server.ts"
  );
}

const files = walk(SRC).map((f) => ({
  path: rel(f),
  text: readFileSync(f, "utf8"),
}));

describe("integration boundary", () => {
  it("only integrations, their routes and the startup hook import from integrations/", () => {
    const offenders = files
      .filter((f) => !mayImportIntegrations(f.path))
      .filter((f) =>
        /(?:from\s+|import\s*\(\s*)["'][^"']*\/integrations\//.test(f.text),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the startup hook only imports registration entry points, one per adapter directory", () => {
    const hook = files.find((f) => f.path === "hooks.server.ts")!;
    const imports = [
      ...hook.text.matchAll(/from\s+["']([^"']*\/integrations\/[^"']*)["']/g),
    ].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec, "import the adapter's index, not its internals").toMatch(
        /^\$lib\/server\/integrations\/[a-z0-9-]+$/,
      );
    }
  });

  it("the core does not name an adapter's system in code outside the schema and registry", () => {
    const offenders = files
      .filter((f) => !mayImportIntegrations(f.path))
      .filter((f) => !f.path.endsWith(".test.ts"))
      .filter((f) => /^lib\/(?:server|tasks|api\/schemas)\//.test(f.path))
      .filter(
        (f) =>
          ![
            "lib/server/schema.ts",
            "lib/api/registry.ts",
            "lib/api/enums.ts",
          ].includes(f.path),
      )
      .filter((f) => /paperless|home\s?assistant/i.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("adapters do not reach into routes or the hook", () => {
    const offenders = files
      .filter((f) => f.path.startsWith("lib/server/integrations/"))
      .filter((f) => !f.path.endsWith(".test.ts"))
      .filter((f) =>
        /from\s+["'](?:\$lib\/server\/api\/|\$app\/|(?:\.\.\/)+routes\/)/.test(
          f.text,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
