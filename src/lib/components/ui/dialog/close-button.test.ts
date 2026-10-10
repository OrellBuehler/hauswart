import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["dialog/dialog-content.svelte", "sheet/sheet-content.svelte"];

// 40px is a touch target; on a desktop it is a big square in the corner of a dialog.
describe.each(files)("close button of %s", (file) => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const classes =
    source.match(/class="([^"]*absolute[^"]*items-center[^"]*)"/)?.[1] ?? "";

  it("is compact with a fine pointer", () => {
    expect(classes).toMatch(/(?:^|\s)size-7(?:\s|$)/);
    expect(classes).toMatch(/(?:^|\s)end-3(?:\s|$)/);
  });

  it("is 40px with a coarse pointer", () => {
    expect(classes).toContain("pointer-coarse:size-10");
    expect(classes).toContain("pointer-coarse:end-1");
  });

  it("is not 40px on every pointer", () => {
    expect(classes).not.toMatch(/(?:^|\s)size-10(?:\s|$)/);
  });
});
