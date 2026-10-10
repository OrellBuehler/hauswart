import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cards = [
  "home-assistant-card.svelte",
  "paperless-card.svelte",
  "kept-card.svelte",
];

/** The token field of a card: the one that tells password managers to keep out. */
function tokenInput(file: string): string {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const inputs = source.match(/<Input\b[^>]*?data-1p-ignore[\s\S]*?\/>/g) ?? [];
  expect(inputs, `${file} has one token field`).toHaveLength(1);
  return inputs[0] ?? "";
}

// The token goes to another system (Home Assistant, Paperless, Kept). Chrome does not honour
// autocomplete="off" on a password field and offers the saved login of this site instead, which
// would then be sent to that system. "new-password" is the value it does honour.
describe.each(cards)("token field of %s", (file) => {
  const input = tokenInput(file);

  it("is a password field that browsers do not fill with a saved login", () => {
    expect(input).toMatch(/type="password"/);
    expect(input).toMatch(/autocomplete="new-password"/);
  });

  it("keeps password managers out", () => {
    expect(input).toMatch(/data-1p-ignore/);
    expect(input).toMatch(/data-lpignore="true"/);
    expect(input).toMatch(/data-bwignore/);
  });
});
