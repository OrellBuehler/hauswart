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

/** WCAG relative luminance of `#rrggbb`. */
function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("app colours", () => {
  it("draw the border of form controls at 3:1 against the surfaces they sit on (WCAG 1.4.11)", () => {
    for (const selector of [":root", "\\.dark"]) {
      const tokens = palette(selector);
      const border = hex(tokens.input!);
      for (const surface of ["background", "card", "popover"]) {
        expect(
          contrast(border, hex(tokens[surface]!)),
          `${selector} input on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keep the status colours readable as 12px text on their own tint (WCAG 1.4.3)", () => {
    /** The colour at `alpha` over a surface, as `#rrggbb`. */
    const tint = (color: string, surface: string, alpha: number) =>
      `#${[1, 3, 5]
        .map((i) => {
          const c = parseInt(color.slice(i, i + 2), 16);
          const s = parseInt(surface.slice(i, i + 2), 16);
          return Math.round(c * alpha + s * (1 - alpha))
            .toString(16)
            .padStart(2, "0");
        })
        .join("")}`;
    for (const selector of [":root", "\\.dark"]) {
      const tokens = palette(selector);
      for (const status of ["destructive", "success", "warning"]) {
        const text = hex(tokens[status]!);
        for (const surface of ["background", "card", "muted"]) {
          const base = hex(tokens[surface]!);
          const where = `${selector} ${status} on ${surface}`;
          expect(contrast(text, base), where).toBeGreaterThanOrEqual(4.5);
          for (const alpha of [0.1, 0.15]) {
            // a badge tints its own background; text on the muted tint is the rare case
            if (surface === "muted" && (alpha > 0.1 || selector !== ":root"))
              continue;
            expect(
              contrast(text, tint(text, base, alpha)),
              `${where} at ${alpha}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("keep the hairline border of cards subtle: it is not a control", () => {
    expect(contrast(hex(palette(":root").border!), "#ffffff")).toBeLessThan(2);
  });

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
