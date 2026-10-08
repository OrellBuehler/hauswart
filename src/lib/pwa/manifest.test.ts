import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./colors";
import { buildManifest, MANIFEST_ICONS } from "./manifest";

const html = readFileSync("src/app.html", "utf8");
const manifest = buildManifest({
  name: "hauswart",
  description: "Sample description",
  lang: "en",
});

/** Width and height from the IHDR chunk of a PNG. */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1"), path).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("makes the app installable as a standalone window", () => {
    expect(manifest).toMatchObject({
      id: "/",
      name: "hauswart",
      short_name: "hauswart",
      lang: "en",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: THEME_COLORS.light,
      theme_color: THEME_COLORS.light,
    });
  });

  it("lists a 192 and a 512 pixel icon and a maskable 512 pixel icon", () => {
    expect(manifest.icons.map((i) => [i.sizes, i.purpose, i.type])).toEqual([
      ["192x192", "any", "image/png"],
      ["512x512", "any", "image/png"],
      ["512x512", "maskable", "image/png"],
    ]);
  });

  it("points at icon files that exist and have the declared size", () => {
    for (const icon of MANIFEST_ICONS) {
      expect(icon.src).toMatch(/^\/icons\/[\w-]+\.png$/);
      expect(pngSize(`static${icon.src}`), icon.src).toBe(icon.sizes);
    }
    expect(pngSize("static/icons/apple-touch-icon.png")).toBe("180x180");
  });

  it("is linked from app.html together with the Apple touch icon", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain(
      '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"',
    );
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('name="mobile-web-app-capable"');
  });
});
