import { describe, expect, it } from "vitest";
import { routerOptions, type OptionsNode } from "./link-options";

/** A chain of elements, innermost first, each with the attributes it carries. */
function chain(...levels: Array<Record<string, string>>): OptionsNode {
  let parent: OptionsNode | null = null;
  for (const attrs of [...levels].reverse()) {
    const up: OptionsNode | null = parent;
    parent = {
      getAttribute: (name) => attrs[name] ?? null,
      parentElement: up,
    };
  }
  return parent as OptionsNode;
}

describe("routerOptions", () => {
  it("is empty for a plain link", () => {
    expect(routerOptions(chain({}, {}, {}))).toEqual({});
  });

  it("reads the three options on the link itself", () => {
    expect(
      routerOptions(
        chain({
          "data-sveltekit-replacestate": "",
          "data-sveltekit-noscroll": "true",
          "data-sveltekit-keepfocus": "off",
        }),
      ),
    ).toEqual({ replaceState: true, noScroll: true, keepFocus: false });
  });

  it("takes the nearest element that sets an option", () => {
    const link = chain(
      {},
      { "data-sveltekit-noscroll": "false" },
      { "data-sveltekit-noscroll": "true", "data-sveltekit-replacestate": "" },
    );
    expect(routerOptions(link)).toEqual({
      replaceState: true,
      noScroll: false,
    });
  });

  it("treats a value the router does not know as not set, and does not look further out", () => {
    const link = chain(
      { "data-sveltekit-keepfocus": "maybe" },
      { "data-sveltekit-keepfocus": "true" },
    );
    expect(routerOptions(link)).toEqual({});
  });
});
