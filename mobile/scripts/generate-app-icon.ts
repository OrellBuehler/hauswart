// Renders the iOS app icon from the mark in static/logo.svg: white on the brand colour,
// full bleed and without transparency (iOS masks the corners itself). Run from the repo root with
// `bun mobile/scripts/generate-app-icon.ts` after the logo or the brand colour changes and commit
// the PNG. The Android icon is a vector (androidApp/src/androidMain/res/drawable).
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { BRAND_COLOR } from "../../src/lib/pwa/colors.ts";

const OUT =
  "mobile/iosApp/Hauswart/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
const SIZE = 1024;
const GLYPH_SHARE = 0.54;
// Bounding box of the glyph in the 256 x 256 view box of the logo.
const GLYPH = { x: 40, y: 20, width: 176, height: 216 };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

/** An RGB PNG: the App Store rejects an icon that has an alpha channel, which the canvas always writes. */
function opaquePng(rgba: Uint8ClampedArray): Buffer {
  const row = SIZE * 3 + 1;
  const raw = Buffer.alloc(row * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const from = (y * SIZE + x) * 4;
      const to = y * row + 1 + x * 3;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = await readFile("static/logo.svg", "utf8");
const glyphPath = /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1];
if (!glyphPath) throw new Error("static/logo.svg has no <path d=…>");

const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d");
ctx.fillStyle = BRAND_COLOR;
ctx.fillRect(0, 0, SIZE, SIZE);
const scale = (SIZE * GLYPH_SHARE) / Math.max(GLYPH.width, GLYPH.height);
ctx.translate(
  (SIZE - GLYPH.width * scale) / 2 - GLYPH.x * scale,
  (SIZE - GLYPH.height * scale) / 2 - GLYPH.y * scale,
);
ctx.scale(scale, scale);
ctx.fillStyle = "#ffffff";
ctx.fill(new Path2D(glyphPath), "evenodd");
await writeFile(OUT, opaquePng(ctx.getImageData(0, 0, SIZE, SIZE).data));
console.log(`wrote ${OUT}`);
