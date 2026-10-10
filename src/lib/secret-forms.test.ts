import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith(".svelte") ? [path] : [];
  });
}

/** A password-type input, written as `type="password"` or as an expression that yields it. */
const SECRET_INPUT = /\btype=(?:"password"|\{[^}]*"password"[^}]*\})/;

const formsOfSecretFiles = svelteFiles("src").flatMap((file) => {
  const source = readFileSync(file, "utf8");
  if (!SECRET_INPUT.test(source)) return [];
  const tags = source.match(/<form\b[^>]*>/g) ?? [];
  return tags.map((tag) => ({ file, tag }));
});

// Pages are rendered on the server and become interactive only once the script has loaded. A form
// without a method is a GET form until then: a submit in that window puts every field, a password or
// a token, into the address, the history and the server's logs.
describe("forms that hold a password or a token", () => {
  it("are found", () => {
    expect(formsOfSecretFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(formsOfSecretFiles.map(({ file, tag }) => [file, tag]))(
    "post in %s",
    (_file, tag) => {
      expect(tag).toMatch(/\smethod="post"/i);
    },
  );
});
