import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it.each([
    ["Küche", "kueche"],
    ["Bad & WC", "bad-wc"],
    ["  Gäste-Zimmer  ", "gaeste-zimmer"],
    ["Straße", "strasse"],
    ["Café Crème", "cafe-creme"],
    ["Mückennetz-Rollo", "mueckennetz-rollo"],
    ["!!!", "item"],
    ["", "item"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps the length and never ends on a hyphen", () => {
    const slug = slugify(`${"a".repeat(57)} bbbbbbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(58);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when free and counts up when taken", () => {
    expect(uniqueSlug("bad", () => false)).toBe("bad");
    const taken = new Set(["bad", "bad-2"]);
    expect(uniqueSlug("bad", (s) => taken.has(s))).toBe("bad-3");
  });
});
