import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const goto = vi.fn(async () => {});
vi.mock("$app/navigation", () => ({
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  goto: (...args: unknown[]) =>
    (goto as (...args: unknown[]) => Promise<void>)(...args),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock("$app/state", () => ({
  navigating: { to: null },
  page: { state: {}, url: new URL("http://localhost/") },
}));

const { gotoFromOverlay } = await import("./use-overlay-history.svelte");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".svelte") ? [path] : [];
  });
}

describe("navigating from an overlay", () => {
  beforeEach(() => {
    goto.mockClear();
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      history: { go: () => {} },
      location: { href: "http://localhost/" },
    });
    vi.stubGlobal("document", { addEventListener: () => {} });
  });

  it("hands the options to goto as they are: the overlay's entry is popped, not replaced", async () => {
    await gotoFromOverlay("/parts/1", { invalidateAll: true });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("/parts/1", { invalidateAll: true });
  });

  it("navigates only after the pop, with no options of its own", async () => {
    await gotoFromOverlay("/parts");
    expect(goto).toHaveBeenCalledWith("/parts", {});
  });

  // A shallow entry carries the navigation index of the page below it. Replacing it with a new page
  // keeps that index, so going back shows the old address over the new page's content.
  it("never marks overlay content for the router's replace-state handling", () => {
    const offenders = sources("src").filter((file) =>
      readFileSync(file, "utf8").includes("data-sveltekit-replacestate"),
    );
    expect(offenders).toEqual([]);
  });
});
