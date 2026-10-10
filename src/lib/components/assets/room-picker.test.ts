import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./room-picker.svelte", import.meta.url),
  "utf8",
);

// The list items are flex rows with a bare text node after the icon: it cannot shrink, so a long
// room name ran out of the list. The name sits in a span that truncates inside the item's last span.
describe("room picker list item", () => {
  it("truncates a long room name instead of clipping it", () => {
    expect(source).toMatch(
      /<span class="min-w-0 truncate">\{room\.name\}<\/span>/,
    );
    expect(source).not.toMatch(/^\s*\{room\.name\}\s*$/m);
  });

  it("keeps icon and name together in the one span the item lays out", () => {
    expect(source).toMatch(
      /<span class="flex min-w-0 items-center gap-2">\s*<Icon[^>]*\/>\s*<span class="min-w-0 truncate">/,
    );
  });
});
