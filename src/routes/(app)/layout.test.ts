import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/routes/(app)/+layout.svelte", "utf8");
const wrapper =
  layout.match(/<div\s+class=\{cn\(([\s\S]*?)\)\}\s*>/)?.[1] ?? "";

describe("space under the page content", () => {
  it("is only reserved for the bottom bar and the round action button where they are", () => {
    // /new and /edit routes have neither: they end under their own save bar
    expect(wrapper).toMatch(/bottomNav\s*&&\s*"pb-\[calc\(/);
    expect(wrapper.split("bottomNav")[0]).not.toMatch(/\bpb-/);
  });

  it("falls back to no bar when the variable is missing", () => {
    expect(layout).not.toMatch(/var\(--bottom-nav\)/);
    expect(wrapper).toContain("var(--bottom-nav,0px)");
  });
});
