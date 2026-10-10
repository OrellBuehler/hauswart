import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn } from "$lib/utils";

const source = readFileSync(
  new URL("./dialog-content.svelte", import.meta.url),
  "utf8",
);
const base = /data-slot="dialog-content"[^]*?class=\{cn\(\s*"([^"]+)"/.exec(
  source,
)?.[1];

const classesOf = (...inputs: string[]) => cn(base, ...inputs).split(/\s+/);

describe("dialog content", () => {
  it("anchors to the top on phones, centred from sm up", () => {
    expect(base).toBeDefined();
    const classes = classesOf();
    expect(classes).toContain("top-(--dialog-top)");
    expect(classes).toContain("translate-y-(--dialog-shift)");
    expect(classes).toContain("[--dialog-top:--spacing(4)]");
    expect(classes).toContain("sm:[--dialog-top:50%]");
    expect(classes).toContain("sm:[--dialog-shift:-50%]");
  });

  it("scrolls itself and keeps the scroll inside", () => {
    const classes = classesOf();
    expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("overscroll-contain");
  });

  it("does not grow past the screen for a long unbroken word", () => {
    const classes = classesOf();
    expect(classes).toContain("grid-cols-[minmax(0,1fr)]");
    expect(classes).toContain("wrap-anywhere");
  });

  it("lets a caller replace position, padding and overflow at every width", () => {
    const classes = classesOf(
      "top-0 translate-y-0 p-0 max-h-none overflow-hidden",
    );
    for (const gone of [
      "top-(--dialog-top)",
      "translate-y-(--dialog-shift)",
      "p-(--dialog-p)",
      "max-h-[calc(100dvh-2rem)]",
      "overflow-y-auto",
    ]) {
      expect(classes).not.toContain(gone);
    }
    for (const kept of ["top-0", "translate-y-0", "p-0", "overflow-hidden"]) {
      expect(classes).toContain(kept);
    }
  });

  it("keeps a caller's own max height and width", () => {
    const classes = classesOf(
      "max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl",
    );
    expect(classes).toContain("max-h-[calc(100svh-2rem)]");
    expect(classes).toContain("sm:max-w-xl");
    expect(classes).not.toContain("sm:max-w-lg");
  });
});
