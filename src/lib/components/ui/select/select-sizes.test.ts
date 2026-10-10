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

// The trigger is 36px on a fine pointer and 40px on a coarse one. A hand-written
// `data-[size=default]:h-10` makes it 40px on the desktop too, taller than the buttons and inputs
// next to it. The task form's own wrapper predates this rule.
const KNOWN = new Set(["src/lib/components/tasks/option-select.svelte"]);

describe("select triggers", () => {
  it("get their sizes from the primitive, not from the page", () => {
    const sized = svelteFiles("src").filter(
      (file) =>
        !file.endsWith("ui/select/select-trigger.svelte") &&
        !KNOWN.has(file) &&
        /data-\[size=(?:default|sm)\]:h-/.test(readFileSync(file, "utf8")),
    );
    expect(sized).toEqual([]);
  });
});
