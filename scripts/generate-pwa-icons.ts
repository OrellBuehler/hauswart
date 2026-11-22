// Renders the app icons in static/icons from the mark in static/logo.svg: white on the
// brand colour, like the logo in the sidebar. Run `bun scripts/generate-pwa-icons.ts` after the
// logo or the brand colour changes and commit the PNGs. It uses @napi-rs/canvas, which the image
// pipeline already depends on, so there is no extra dependency.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { BRAND_COLOR } from "../src/lib/pwa/colors.ts";

const OUT_DIR = "static/icons";

const svg = await readFile("static/logo.svg", "utf8");
const glyphPath = /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1];
if (!glyphPath) throw new Error("static/logo.svg has no <path d=…>");
// Bounding box of the glyph in the 256 x 256 view box of the logo.
const GLYPH = { x: 40, y: 20, width: 176, height: 216 };
const glyph = new Path2D(glyphPath);

interface Icon {
  file: string;
  size: number;
  /** The longer side of the glyph as a share of the icon. */
  glyphShare: number;
  /** Corner radius as a share of the icon; 0 = full bleed (the platform masks it). */
  radius: number;
}

// "maskable" icons are cropped to a circle of 80 % of their size by some launchers, so the glyph
// stays well inside it. The Apple icon is masked by iOS, which fills transparency with black.
const ICONS: Icon[] = [
  { file: "icon-192.png", size: 192, glyphShare: 0.58, radius: 0.22 },
  { file: "icon-512.png", size: 512, glyphShare: 0.58, radius: 0.22 },
  { file: "icon-maskable-512.png", size: 512, glyphShare: 0.52, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, glyphShare: 0.58, radius: 0 },
];

function render({ size, glyphShare, radius }: Icon): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BRAND_COLOR;
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }
  const scale = (size * glyphShare) / Math.max(GLYPH.width, GLYPH.height);
  ctx.translate(
    (size - GLYPH.width * scale) / 2 - GLYPH.x * scale,
    (size - GLYPH.height * scale) / 2 - GLYPH.y * scale,
  );
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fill(glyph, "evenodd");
  return canvas.toBuffer("image/png");
}

await mkdir(OUT_DIR, { recursive: true });
for (const icon of ICONS) {
  await writeFile(`${OUT_DIR}/${icon.file}`, render(icon));
  console.log(`${OUT_DIR}/${icon.file}`);
}
