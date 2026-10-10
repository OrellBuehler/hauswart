import { describe, expect, it } from "vitest";
import { cn } from "$lib/utils";
import { buttonVariants } from "./button.svelte";

type Size = NonNullable<Parameters<typeof buttonVariants>[0]>["size"];

const coarse: Record<NonNullable<Size>, string[]> = {
  default: ["pointer-coarse:min-h-10"],
  sm: ["pointer-coarse:min-h-10"],
  lg: ["pointer-coarse:min-h-11"],
  icon: ["pointer-coarse:min-h-10", "pointer-coarse:min-w-10"],
  "icon-sm": ["pointer-coarse:min-h-10", "pointer-coarse:min-w-10"],
  "icon-lg": ["pointer-coarse:min-h-11", "pointer-coarse:min-w-11"],
};
const sizes = Object.keys(coarse) as Array<NonNullable<Size>>;

// A fixed pointer-coarse height or width sits after the caller's plain h-14 in the stylesheet and
// wins over it, so a bigger button rendered smaller on touch screens and `h-auto` did nothing.
const fixedTouchSize = /(?:^|\s)pointer-coarse:(?:h|w|size)-/;

describe("button sizes on coarse pointers", () => {
  for (const size of sizes) {
    it(`${size} grows to a touch target with a minimum, not a fixed size`, () => {
      const classes = buttonVariants({ size }).split(/\s+/);
      for (const expected of coarse[size]) expect(classes).toContain(expected);
      expect(buttonVariants({ size })).not.toMatch(fixedTouchSize);
    });
  }

  it("keeps the touch minimum when a caller sets a smaller height or size", () => {
    for (const override of ["h-8", "h-7", "size-7", "size-9", "sm:h-8"]) {
      for (const size of ["default", "sm", "icon", "icon-sm"] as const) {
        const merged = cn(buttonVariants({ size }), override).split(/\s+/);
        expect(merged).toContain(override);
        for (const expected of coarse[size]) expect(merged).toContain(expected);
      }
    }
  });

  it("lets a caller's bigger height or size win on touch screens too", () => {
    for (const override of ["h-12", "h-14", "size-14", "h-auto"]) {
      for (const size of sizes) {
        const merged = cn(buttonVariants({ size }), override);
        expect(merged.split(/\s+/)).toContain(override);
        expect(merged).not.toMatch(fixedTouchSize);
      }
    }
  });

  it("leaves the fine pointer sizes alone", () => {
    expect(buttonVariants({ size: "default" })).toContain("h-9");
    expect(buttonVariants({ size: "sm" })).toContain("h-8");
    expect(buttonVariants({ size: "lg" })).toContain("h-10");
    expect(buttonVariants({ size: "icon" })).toContain("size-9");
  });
});
