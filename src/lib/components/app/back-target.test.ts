import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { backTarget, SECTIONS } from "./back-target";
import { navGroups } from "./nav";

describe("the back arrow in the header", () => {
  it.each([
    ["/tasks/12", "/tasks"],
    ["/tasks/12/edit", "/tasks/12"],
    ["/tasks/new", "/tasks"],
    ["/defects/7", "/defects"],
    ["/defects/7/edit", "/defects/7"],
    ["/defects/new", "/defects"],
    ["/costs/9", "/costs"],
    ["/costs/9/edit", "/costs/9"],
    ["/costs/new", "/costs"],
    ["/costs/inbox", "/costs"],
    ["/docs/wifi", "/docs"],
    ["/docs/wifi/edit", "/docs/wifi"],
    ["/docs/new", "/docs"],
    ["/parts/3", "/parts"],
    ["/contacts/3", "/contacts"],
    ["/rooms/5", "/rooms"],
    ["/rooms/5/qr", "/rooms/5"],
    ["/insurance/4", "/insurance"],
    ["/insurance/4/edit", "/insurance/4"],
    ["/insurance/new", "/insurance"],
  ])("leads from %s to its parent %s", (from, to) => {
    expect(backTarget(from)).toBe(to);
  });

  it.each([
    ["/assets/abc", "/inventory"],
    ["/assets/abc/edit", "/assets/abc"],
    ["/assets/new", "/inventory"],
    ["/d/boiler-1", "/inventory"],
    ["/inventory/qr", "/inventory"],
  ])("sends the pages of a device to the inventory: %s -> %s", (from, to) => {
    expect(backTarget(from)).toBe(to);
  });

  it.each([
    "/",
    "/tasks",
    "/inventory",
    "/docs",
    "/search",
    "/notifications",
    "/settings/account",
    "/settings/tokens",
    "/settings/integrations",
    "/admin/users",
  ])("shows no arrow on %s: the navigation reaches it directly", (path) => {
    expect(backTarget(path)).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(backTarget("/tasks/12/")).toBe("/tasks");
    expect(backTarget("/tasks/")).toBeNull();
  });

  it("does not guess for addresses that are no page of the app", () => {
    expect(backTarget("/unknown/page")).toBeNull();
    expect(backTarget("/api/v1/tasks")).toBeNull();
  });

  it("only leads to pages that exist", () => {
    const pages = new Set(
      readdirSync("src/routes/(app)", { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith("+page.svelte"))
        .map((file) => file.replace(/\+page\.svelte$/, "").replace(/\/$/, ""))
        .map((dir) => dir.replace(/\[[^\]]+\]/g, "*")),
    );
    pages.add(""); // the dashboard
    const exists = (path: string) =>
      [...pages].some((page) => {
        const want = path.split("/").filter(Boolean);
        const have = page.split("/").filter(Boolean);
        return (
          want.length === have.length &&
          have.every((part, i) => part === "*" || part === want[i])
        );
      });
    for (const path of [
      "/tasks/12/edit",
      "/tasks/new",
      "/defects/7/edit",
      "/costs/9/edit",
      "/costs/inbox",
      "/docs/wifi/edit",
      "/docs/new",
      "/assets/abc/edit",
      "/assets/new",
      "/inventory/qr",
      "/rooms/5/qr",
      "/d/boiler-1",
      "/parts/3",
      "/contacts/3",
    ]) {
      expect(exists(path), `${path} is a page`).toBe(true);
      expect(exists(backTarget(path)!), `${path} -> ${backTarget(path)}`).toBe(
        true,
      );
    }
  });

  it("knows every section of the navigation", () => {
    const sections = navGroups
      .flatMap((group) => group.items)
      .map((item) => item.href.split("/")[1]!)
      .filter(Boolean); // the dashboard has no section
    for (const section of sections) {
      expect(SECTIONS, section).toContain(section);
    }
  });
});
