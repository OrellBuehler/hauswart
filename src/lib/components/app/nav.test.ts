import { describe, expect, it } from "vitest";
import { findNavItem, navGroups, visibleNavGroups } from "./nav";

const hrefs = (groups: ReturnType<typeof visibleNavGroups>) =>
  groups.flatMap((group) => group.items.map((item) => item.href));

describe("navigation", () => {
  it("offers the documents of a document system only to people who have one", () => {
    expect(
      hrefs(visibleNavGroups(navGroups, { documentSystem: true })),
    ).toContain("/documents");
    expect(
      hrefs(visibleNavGroups(navGroups, { documentSystem: false })),
    ).not.toContain("/documents");
  });

  it("keeps every other entry and never leaves an empty group", () => {
    const without = visibleNavGroups(navGroups, { documentSystem: false });
    const withSystem = visibleNavGroups(navGroups, { documentSystem: true });
    expect(without).toHaveLength(navGroups.length);
    expect(hrefs(withSystem).filter((href) => href !== "/documents")).toEqual(
      hrefs(without),
    );
    for (const group of without) expect(group.items.length).toBeGreaterThan(0);
  });

  it("knows the page of an entry that is hidden, so its title still shows", () => {
    expect(findNavItem("/documents")?.href).toBe("/documents");
  });
});
