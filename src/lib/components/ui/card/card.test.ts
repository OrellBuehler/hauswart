import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Card from "./card.svelte";
import CardContent from "./card-content.svelte";
import CardHeader from "./card-header.svelte";

const classesOf = (component: unknown, props: Record<string, unknown> = {}) => {
  const body = render(component as never, { props: props as never }).body;
  return /class="([^"]*)"/.exec(body)?.[1].split(/\s+/) ?? [];
};

describe("card spacing", () => {
  it("is tighter on phones and as before from sm up", () => {
    const classes = classesOf(Card);
    expect(classes).toContain("py-(--card-py)");
    expect(classes).toContain("gap-(--card-gap)");
    expect(classes).toContain("[--card-py:--spacing(4)]");
    expect(classes).toContain("sm:[--card-py:--spacing(6)]");
    expect(classes).toContain("sm:[--card-gap:--spacing(6)]");
    expect(classes).toContain("sm:[--card-px:--spacing(6)]");
  });

  it("lets a caller drop padding and gap at every width", () => {
    const classes = classesOf(Card, { class: "gap-0 py-0" });
    expect(classes).toContain("gap-0");
    expect(classes).toContain("py-0");
    expect(classes).not.toContain("py-(--card-py)");
    expect(classes).not.toContain("gap-(--card-gap)");
  });

  it("can shrink inside grids and flex rows", () => {
    expect(classesOf(Card)).toContain("min-w-0");
  });

  it("pads header and content by the card's horizontal padding", () => {
    expect(classesOf(CardHeader)).toContain("px-(--card-px,--spacing(6))");
    expect(classesOf(CardContent)).toContain("px-(--card-px,--spacing(6))");
    expect(classesOf(CardContent, { class: "px-0" })).toContain("px-0");
    expect(classesOf(CardContent, { class: "px-0" })).not.toContain(
      "px-(--card-px,--spacing(6))",
    );
  });
});
