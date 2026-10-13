import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostTagRef } from "$lib/api/schemas/cost-tags";
import TagChips from "./tag-chips.svelte";

const tag = (
  id: string,
  name: string,
  color: CostTagRef["color"] = "blue",
) => ({
  id,
  name,
  color,
});

const html = (tags: CostTagRef[], limit?: number) =>
  render(TagChips as never, { props: { tags, limit } as never }).body;

describe("TagChips", () => {
  it("shows nothing for an entry without tags", () => {
    expect(html([])).not.toContain("<span");
  });

  it("shows every tag by name, with the colour classes of its key", () => {
    const body = html([tag("1", "Ferien"), tag("2", "Steuern", "green")]);
    expect(body).toContain("Ferien");
    expect(body).toContain("Steuern");
    expect(body).toContain("bg-blue-100");
    expect(body).toContain("bg-green-100");
    expect(body).toContain("dark:bg-green-950");
  });

  it("names the group for a screen reader", () => {
    expect(html([tag("1", "Ferien")])).toContain("Tags:</span>");
  });

  it("folds tags beyond the limit into +n and still names them for a screen reader", () => {
    const body = html(
      [
        tag("1", "A"),
        tag("2", "B"),
        tag("3", "C"),
        tag("4", "D"),
        tag("5", "E"),
      ],
      3,
    );
    expect(body).toContain("+2");
    expect(body).toContain('title="D, E"');
    expect(body).toContain('sr-only">D, E<');
    expect(body).not.toContain(">D</span></span>");
  });

  it("does not fold what fits", () => {
    expect(html([tag("1", "A"), tag("2", "B")], 3)).not.toContain("+");
  });

  it("keeps a long name from widening the row", () => {
    const body = html([tag("1", "x".repeat(40))]);
    expect(body).toContain("truncate");
    expect(body).toContain("max-w-full");
  });
});
