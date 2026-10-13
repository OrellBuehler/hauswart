import { describe, expect, it } from "vitest";
import { COST_TAG_COLORS } from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import { MAX_COST_TAGS, MAX_TAGS_PER_COST } from "$lib/api/schemas/cost-tags";
import {
  TAG_COLOR_STYLES,
  canAddTag,
  knownTagId,
  knownTagIds,
  nextTagColor,
  sameTagIds,
  sortTags,
  tagColorLabels,
  tagDeleteDescription,
  tagIdsOf,
  tagNameProblem,
  tagNameTaken,
  tagNames,
  tagSaveMessage,
  toggleTagId,
} from "./tags";

const tag = (id: string, name: string, color = "gray" as const) => ({
  id,
  name,
  color,
});

describe("tag colours", () => {
  it("styles and names every key of the palette, and only those", () => {
    expect(Object.keys(TAG_COLOR_STYLES).sort()).toEqual(
      [...COST_TAG_COLORS].sort(),
    );
    expect(Object.keys(tagColorLabels).sort()).toEqual(
      [...COST_TAG_COLORS].sort(),
    );
    for (const color of COST_TAG_COLORS) {
      expect(tagColorLabels[color]()).not.toBe("");
      expect(TAG_COLOR_STYLES[color].chip).toContain("dark:");
    }
  });

  it("names the colours in both languages", () => {
    expect(tagColorLabels.amber()).toBe("Gelb");
    expect(tagColorLabels.gray()).toBe("Grau");
  });

  it("picks the palette colour the fewest tags have, never grey, the first on a tie", () => {
    expect(nextTagColor([])).toBe("red");
    expect(nextTagColor([tag("1", "a", "gray")])).toBe("red");
    expect(nextTagColor([{ color: "red" }])).toBe("orange");
    expect(
      nextTagColor(
        COST_TAG_COLORS.filter((c) => c !== "gray").map((color) => ({ color })),
      ),
    ).toBe("red");
    expect(
      nextTagColor([
        ...COST_TAG_COLORS.filter((c) => c !== "gray" && c !== "pink").map(
          (color) => ({ color }),
        ),
      ]),
    ).toBe("pink");
  });
});

describe("choosing tags", () => {
  it("sorts by name without regard to case", () => {
    expect(
      sortTags([tag("1", "zebra"), tag("2", "Äpfel"), tag("3", "apfel")]).map(
        (t) => t.name,
      ),
    ).toEqual(["Äpfel", "apfel", "zebra"]);
    expect(sortTags([tag("1", "b"), tag("2", "A")]).map((t) => t.id)).toEqual([
      "2",
      "1",
    ]);
  });

  it("lists names and ids", () => {
    const tags = [tag("1", "Ferien"), tag("2", "Steuern")];
    expect(tagNames(tags)).toBe("Ferien, Steuern");
    expect(tagIdsOf(tags)).toEqual(["1", "2"]);
    expect(tagNames([])).toBe("");
  });

  it("toggles a tag on and off", () => {
    expect(toggleTagId([], "a")).toEqual(["a"]);
    expect(toggleTagId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTagId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("stops adding at the limit of an entry but still takes one off", () => {
    const full = Array.from({ length: MAX_TAGS_PER_COST }, (_, i) => `t${i}`);
    expect(canAddTag(full)).toBe(false);
    expect(canAddTag(full.slice(1))).toBe(true);
    expect(toggleTagId(full, "extra")).toEqual(full);
    expect(toggleTagId(full, "t0")).toEqual(full.slice(1));
    expect(toggleTagId(["a"], "b", 1)).toEqual(["a"]);
  });

  it("compares lists of ids without regard to order", () => {
    expect(sameTagIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameTagIds(["a"], ["a", "b"])).toBe(false);
    expect(sameTagIds([], [])).toBe(true);
  });

  it("drops ids of tags that are gone", () => {
    const tags = [tag("1", "a"), tag("2", "b")];
    expect(knownTagIds(["1", "9", "2"], tags)).toEqual(["1", "2"]);
    expect(knownTagId("2", tags)).toBe("2");
    expect(knownTagId("9", tags)).toBe("");
    expect(knownTagId("", tags)).toBe("");
  });
});

describe("tag names", () => {
  const tags = [tag("1", "Ferien"), tag("2", "Steuern")];

  it("finds a name that is taken, whatever the case, except for the tag being edited", () => {
    expect(tagNameTaken("ferien", tags)).toBe(true);
    expect(tagNameTaken("  FERIEN ", tags)).toBe(true);
    expect(tagNameTaken("Ferien", tags, "1")).toBe(false);
    expect(tagNameTaken("Ferien", tags, "2")).toBe(true);
    expect(tagNameTaken("Neu", tags)).toBe(false);
  });

  it("finds a name that is taken beyond ASCII, whatever the case and the spelling of the umlaut", () => {
    const umlauts = [tag("1", "Übernachtung")];
    expect(tagNameTaken("übernachtung", umlauts)).toBe(true);
    expect(tagNameTaken("ÜBERNACHTUNG", umlauts)).toBe(true);
    expect(tagNameTaken("U\u0308bernachtung", umlauts)).toBe(true);
    expect(tagNameTaken("Ubernachtung", umlauts)).toBe(false);
    expect(tagNameTaken("Übernachtung", umlauts, "1")).toBe(false);
  });

  it("says what is wrong with a name", () => {
    expect(tagNameProblem("", tags)).toBe("Pflichtfeld.");
    expect(tagNameProblem("   ", tags)).toBe("Pflichtfeld.");
    expect(tagNameProblem("x".repeat(41), tags)).toContain("40");
    expect(tagNameProblem("ferien", tags)).toBe(
      "Einen Tag mit diesem Namen gibt es schon.",
    );
    expect(tagNameProblem("x".repeat(40), tags)).toBeUndefined();
    expect(tagNameProblem("Neu", tags)).toBeUndefined();
    expect(tagNameProblem("Ferien", tags, "1")).toBeUndefined();
  });

  it("words a 409 as a taken name, or as the limit for a new tag when the household has all it may", () => {
    const conflict = new ApiError("conflict", "x");
    expect(tagSaveMessage(conflict, tags, true)).toBe(
      "Einen Tag mit diesem Namen gibt es schon.",
    );
    expect(tagSaveMessage(conflict, tags, false)).toBe(
      "Einen Tag mit diesem Namen gibt es schon.",
    );
    const all = Array.from({ length: MAX_COST_TAGS }, (_, i) => i);
    expect(tagSaveMessage(conflict, all, true)).toContain(
      String(MAX_COST_TAGS),
    );
    expect(tagSaveMessage(conflict, all, false)).toBe(
      "Einen Tag mit diesem Namen gibt es schon.",
    );
    expect(
      tagSaveMessage(new ApiError("internal", "x"), tags, true),
    ).toBeUndefined();
    expect(tagSaveMessage(new Error("x"), tags, true)).toBeUndefined();
  });
});

describe("deleting a tag", () => {
  it("says how many entries lose it, and that they stay", () => {
    const text = tagDeleteDescription({ name: "Ferien", entryCount: 12 });
    expect(text).toContain("«Ferien»");
    expect(text).toContain("12 Einträgen");
    expect(text).toContain("bleiben bestehen");
    expect(tagDeleteDescription({ name: "Ferien", entryCount: 1 })).toContain(
      "1 Eintrag",
    );
  });

  it("is short for a tag nobody carries", () => {
    expect(tagDeleteDescription({ name: "Ferien", entryCount: 0 })).toBe(
      "«Ferien» wird gelöscht. Kein Eintrag trägt ihn.",
    );
  });

  it("is worded in English too", () => {
    expect(
      tagDeleteDescription({ name: "Holiday", entryCount: 3 }).length,
    ).toBeGreaterThan(0);
  });
});
