import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app.css", "utf8");
const root = readFileSync("src/routes/+layout.svelte", "utf8");

// The toaster switches from its mobile offset to its default one at 600px, the bottom bar and the
// round action button go away at 768px. Between the two, toasts sat on top of the button.
describe("toast position", () => {
  it("takes one value at every width, from the bottom bar's variable", () => {
    expect(root).toMatch(
      /offset=\{\{ bottom: "var\(--toast-bottom, 2rem\)" \}\}/,
    );
    expect(root).toMatch(
      /mobileOffset=\{\{ bottom: "var\(--toast-bottom, 5rem\)" \}\}/,
    );
  });

  it("rises above the bar and the button below md, and only there", () => {
    expect(css).toMatch(/:root \{[^}]*--toast-bottom: 2rem;/);
    const phones = css.match(
      /@media \(width < 48rem\) \{([\s\S]*?\n {2}\})\n/,
    )?.[1];
    expect(phones).toMatch(
      /--toast-bottom: calc\(\s*var\(--bottom-nav\) \+ env\(safe-area-inset-bottom, 0px\) \+ 5rem\s*\)/,
    );
  });
});
