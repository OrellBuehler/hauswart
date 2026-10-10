import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Primitives whose callers set their own sizes: a fixed touch height would beat those.
const files = [
  "button/button.svelte",
  "input/input.svelte",
  "select/select-trigger.svelte",
  "sidebar/sidebar-trigger.svelte",
];

describe.each(files)("touch sizes of %s", (file) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");

  it("are minimums", () => {
    expect(source).not.toMatch(
      /pointer-coarse:(?:data-\[[^\]]+\]:)?(?:h|w|size)-\d/,
    );
    expect(source).toMatch(/pointer-coarse:(?:data-\[[^\]]+\]:)?min-h-\d/);
  });
});
