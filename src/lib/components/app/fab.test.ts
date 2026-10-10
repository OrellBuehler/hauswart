import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Fab from "./fab.svelte";

const { body } = render(Fab as never, {
  props: { href: "/tasks/new", label: "Neue Aufgabe" } as never,
});

describe("round action button", () => {
  it("is a link with an accessible name and no visible text", () => {
    expect(body).toMatch(/<a\b[^>]*href="\/tasks\/new"/);
    expect(body).toMatch(/aria-label="Neue Aufgabe"/);
    expect(body.replace(/<[^>]*>/g, "").trim()).toBe("");
  });

  it("floats above the bottom bar on phones and gives way from md up", () => {
    expect(body).toContain("fixed");
    expect(body).toContain("md:hidden");
    expect(body).toContain(
      "bottom-[calc(var(--bottom-nav,0px)+env(safe-area-inset-bottom)+1rem)]",
    );
  });

  it("draws a plus by default", () => {
    expect(body).toContain("lucide-plus");
  });
});
