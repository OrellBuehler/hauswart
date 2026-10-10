import { describe, expect, it } from "vitest";
import { cn } from "$lib/utils";
import { buttonVariants } from "./button.svelte";

type Size = NonNullable<Parameters<typeof buttonVariants>[0]>["size"];

const coarse: Record<NonNullable<Size>, string> = {
  default: "pointer-coarse:h-10",
  sm: "pointer-coarse:h-10",
  lg: "pointer-coarse:h-11",
  icon: "pointer-coarse:size-10",
  "icon-sm": "pointer-coarse:size-10",
  "icon-lg": "pointer-coarse:size-11",
};

describe("button sizes on coarse pointers", () => {
  for (const [size, expected] of Object.entries(coarse)) {
    it(`${size} grows to a touch target`, () => {
      const classes = buttonVariants({ size: size as Size }).split(/\s+/);
      expect(classes).toContain(expected);
    });
  }

  it("keeps the touch size when a caller sets its own height or size", () => {
    for (const override of ["h-8", "h-7", "size-7", "size-9", "sm:h-8"]) {
      for (const size of ["default", "sm", "icon", "icon-sm"] as const) {
        const merged = cn(buttonVariants({ size }), override).split(/\s+/);
        expect(merged).toContain(override);
        expect(merged).toContain(coarse[size]);
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
