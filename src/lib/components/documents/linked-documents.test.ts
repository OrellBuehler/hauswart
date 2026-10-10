import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const linked = source("./linked-documents.svelte");
const header = source("../ui/card/card-header.svelte");

// The card often sits in a column of about 300px next to others, whatever the window's width: a
// button that grows a label from the `sm` breakpoint pushed out of it at 1280px.
describe("the add button in the header of the linked documents card", () => {
  it("shows its label by the width of the card header, not of the window", () => {
    const snippet = linked.match(
      /\{#snippet headerAddButton\(\)\}([\s\S]*?)\{\/snippet\}/,
    )?.[1];
    expect(snippet).toContain("@md/card-header:hidden");
    expect(snippet).toContain("hidden @md/card-header:inline-flex");
    expect(snippet).not.toMatch(/\bsm:|max-sm:/);
  });
});

describe("card header", () => {
  it("lets the title column shrink next to an action", () => {
    expect(header).toContain(
      "has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(header).not.toContain("grid-cols-[1fr_auto]");
  });

  it("is the container the add button asks", () => {
    expect(header).toContain("@container/card-header");
  });
});
