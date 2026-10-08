import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_COLOR, THEME_COLORS } from "./colors";

const css = readFileSync("src/app.css", "utf8");
const html = readFileSync("src/app.html", "utf8");

/** The declarations of the palette block that starts with `selector` (two-space indented). */
function palette(selector: string): Record<string, string> {
  const block = new RegExp(`\\n  ${selector} \\{([^}]*)\\}`).exec(css)?.[1];
  if (!block) throw new Error(`no ${selector} block in app.css`);
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!]),
  );
}

/** `220 20% 98.5%` (the form of the tokens) as `#rrggbb`. */
function hex(token: string): string {
  const [h, s, l] = token.match(/[\d.]+/g)!.map(Number) as [
    number,
    number,
    number,
  ];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

describe("app colours", () => {
  it("follow the tokens of app.css", () => {
    expect(hex(palette(":root").background!)).toBe(THEME_COLORS.light);
    expect(hex(palette("\\.dark").background!)).toBe(THEME_COLORS.dark);
    expect(hex(palette(":root").brand!)).toBe(BRAND_COLOR);
  });

  it("are the theme-color tags of app.html, one per system palette", () => {
    const tags = [...html.matchAll(/<meta\s+name="theme-color"[^>]*>/g)].map(
      (m) => m[0].replace(/\s+/g, " "),
    );
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain(`content="${THEME_COLORS.light}"`);
    expect(tags[0]).toContain("(prefers-color-scheme: light)");
    expect(tags[1]).toContain(`content="${THEME_COLORS.dark}"`);
    expect(tags[1]).toContain("(prefers-color-scheme: dark)");
  });
});
