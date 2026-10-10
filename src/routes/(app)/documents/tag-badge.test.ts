import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/(app)/documents/+page.svelte", "utf8");

// A badge is an inline-flex box: text-overflow does nothing on it, so a tag name wider than the
// badge's max width was cut off without an ellipsis. The name needs a block of its own to truncate.
describe("tag badges of the documents list", () => {
  it("truncate the name inside the badge, not the badge", () => {
    expect(source).toMatch(
      /<Badge variant="secondary" class="max-w-32">\s*<span class="truncate">\{name\}<\/span>\s*<\/Badge>/,
    );
    expect(source).not.toMatch(/<Badge[^>]*\btruncate\b/);
  });
});
