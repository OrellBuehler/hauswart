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

  it("reads both options on the link itself", () => {
    expect(
      routerOptions(
        chain({
          "data-sveltekit-replacestate": "",
          "data-sveltekit-reset": "false",
        }),
      ),
    ).toEqual({ replace: true, reset: false });
  });

  it("takes the nearest element that sets an option", () => {
    const link = chain(
      {},
      { "data-sveltekit-reset": "false" },
      { "data-sveltekit-reset": "true", "data-sveltekit-replacestate": "" },
    );
    expect(routerOptions(link)).toEqual({ replace: true, reset: false });
  });

  it("treats a value the router does not know as not set, and does not look further out", () => {
    const link = chain(
      { "data-sveltekit-reset": "off" },
      { "data-sveltekit-reset": "true" },
    );
    expect(routerOptions(link)).toEqual({});
  });

  it("ignores the options SvelteKit 3 no longer has", () => {
    const link = chain({
      "data-sveltekit-noscroll": "",
      "data-sveltekit-keepfocus": "true",
    });
    expect(routerOptions(link)).toEqual({});
  });
});
