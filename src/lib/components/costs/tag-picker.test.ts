import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { CostTag } from "$lib/api/schemas/cost-tags";
import TagPicker from "./tag-picker.svelte";

const tag = (
  id: string,
  name: string,
  color: CostTag["color"] = "blue",
): CostTag => ({
  id,
  name,
  color,
  entryCount: 0,
  createdAt: "2026-01-01T08:00:00.000Z",
  updatedAt: "2026-01-01T08:00:00.000Z",
});

const html = (props: Record<string, unknown>) =>
  render(TagPicker as never, {
    props: { id: "t", tags: [], value: [], ...props } as never,
  }).body;

describe("TagPicker", () => {
  const tags = [tag("1", "Ferien"), tag("2", "Steuern", "green")];

  it("offers every tag as a toggle button and says how many an entry may carry", () => {
    const body = html({ tags });
    expect(body).toContain("Ferien");
    expect(body).toContain("Steuern");
    expect(body.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(body).toContain("Höchstens 10 pro Eintrag.");
  });

  it("shows a chosen tag as pressed, ticked and counted", () => {
    const body = html({ tags, value: ["1"] });
    expect(body.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(body).toContain("1 Tag gewählt");
    expect(body).toContain("ring-2");
  });

  it("locks the tags that are not chosen once the limit is reached, and says why", () => {
    const many = Array.from({ length: 11 }, (_, i) => tag(`t${i}`, `Tag ${i}`));
    const body = html({
      tags: many,
      value: many.slice(0, 10).map((t) => t.id),
    });
    expect(body).toContain("Mehr als 10 Tags pro Eintrag gehen nicht");
    expect(body.match(/disabled/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("says there are no tags yet, and where to make them when the picker cannot", () => {
    const body = html({ tags: [] });
    expect(body).toContain("Es gibt noch keine Tags.");
    expect(body).toContain('href="/settings/cost-tags"');
  });

  it("offers a new tag only where it may be made", () => {
    expect(html({ tags, creatable: true })).toContain("Neuer Tag");
    expect(html({ tags })).not.toContain("Neuer Tag");
    expect(html({ tags: [], creatable: true })).not.toContain(
      'href="/settings/cost-tags"',
    );
  });

  it("shows what the server refused", () => {
    expect(html({ tags, error: "Ungültig." })).toContain("Ungültig.");
  });

  it("narrows a long list by typing", () => {
    const long = Array.from({ length: 12 }, (_, i) => tag(`t${i}`, `Tag ${i}`));
    expect(html({ tags: long })).toContain("Tags durchsuchen");
    expect(html({ tags })).not.toContain("Tags durchsuchen");
  });
});
