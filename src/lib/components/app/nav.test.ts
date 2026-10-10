import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";
import {
  findNavItem,
  headerTitleFor,
  isMoreActive,
  isNavActive,
  mobileTabs,
  navGroups,
  showsBottomNav,
  visibleNavGroups,
} from "./nav";

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

describe("bottom bar on phones", () => {
  it("has four tabs: dashboard, tasks, inventory and documentation", () => {
    expect(mobileTabs.map((item) => item.href)).toEqual([
      "/",
      "/tasks",
      "/inventory",
      "/docs",
    ]);
  });

  it("names the tabs short enough for a fifth of a 360 pixel screen", () => {
    for (const item of mobileTabs) {
      expect((item.shortLabel ?? item.label)().length, item.href).toBeLessThan(
        11,
      );
    }
  });

  it("marks a tab for its pages too, and exactly one tab at a time", () => {
    const active = (pathname: string) =>
      mobileTabs.filter((item) => isNavActive(item, pathname)).length;
    for (const pathname of [
      "/",
      "/tasks",
      "/tasks/12",
      "/inventory",
      "/inventory/qr",
      "/assets/abc",
      "/d/boiler",
      "/docs",
      "/docs/wifi",
    ]) {
      expect(active(pathname), pathname).toBe(1);
      expect(isMoreActive(pathname), pathname).toBe(false);
    }
  });

  it("highlights More on every page that has no tab", () => {
    for (const pathname of [
      "/costs",
      "/rooms/5",
      "/documents",
      "/defects/3",
      "/settings/account",
      "/admin/users",
      "/notifications",
      "/search",
      "/emergency",
    ]) {
      expect(isMoreActive(pathname), pathname).toBe(true);
    }
  });

  it("gives way to the save bar of a form", () => {
    for (const pathname of [
      "/tasks/new",
      "/tasks/12/edit",
      "/docs/wifi/edit",
      "/assets/new",
      "/costs/new/",
    ]) {
      expect(showsBottomNav(pathname), pathname).toBe(false);
    }
    for (const pathname of ["/", "/tasks", "/tasks/12", "/newsletter"]) {
      expect(showsBottomNav(pathname), pathname).toBe(true);
    }
  });
});

describe("header title", () => {
  it("is the navigation entry of the page", () => {
    expect(headerTitleFor("/tasks/12")).toBe(m.nav_tasks());
    expect(headerTitleFor("/assets/abc")).toBe(m.nav_inventory());
    expect(headerTitleFor("/settings/tokens")).toBe(m.nav_settings());
    expect(headerTitleFor("/emergency")).toBe(m.nav_emergency());
  });

  it("names the pages that are reached from the header, not the app", () => {
    expect(headerTitleFor("/notifications")).toBe(m.notifications_title());
    expect(headerTitleFor("/search")).toBe(m.search_page_title());
    expect(headerTitleFor("/notifications")).not.toBe(m.app_name());
  });

  it("falls back to the name of the app", () => {
    expect(headerTitleFor("/nowhere")).toBe(m.app_name());
  });
});
