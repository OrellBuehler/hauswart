// Renders the store images from the raw screenshots of the workflow `Mobile Store Screenshots`
// (mobile/scripts/screenshots): one image per slide of slides.ts with a headline and the screen in
// a phone frame, and the feature graphic of Google Play. It draws with @napi-rs/canvas, which the
// server already depends on, so there is no browser and no extra dependency.
//
// Usage: bun mobile/store/render.ts --out <dir> [--ios <dir>] [--android <dir>]
//   --ios, --android   folders with <locale>/<screen>.png, as the capture scripts write them
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  Path2D,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { BRAND_COLOR } from "../../src/lib/pwa/colors.ts";
import { feature, slides, type Locale, type Slide } from "./slides.ts";

const { values } = parseArgs({
  options: {
    ios: { type: "string" },
    android: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.out || (!values.ios && !values.android)) {
  console.error(
    "Usage: bun mobile/store/render.ts --out <dir> [--ios <dir>] [--android <dir>]",
  );
  process.exit(1);
}
const outDir = values.out;

const repo = new URL("../../", import.meta.url).pathname;
const fonts = join(repo, "node_modules/@fontsource-variable/inter/files");
for (const file of [
  "inter-latin-wght-normal.woff2",
  "inter-latin-ext-wght-normal.woff2",
]) {
  if (!GlobalFonts.registerFromPath(join(fonts, file), "Inter"))
    throw new Error(`Cannot load the font ${file}`);
}

const logoSvg = await readFile(join(repo, "static/logo.svg"), "utf8");
const logoPath = /<path[^>]*\sd="([^"]+)"/.exec(logoSvg)?.[1];
if (!logoPath) throw new Error("static/logo.svg has no <path d=…>");
const logo = new Path2D(logoPath);

type Device = "iphone" | "android";

interface Target {
  key: string;
  device: Device;
  source: string;
  width: number;
  height: number;
}

const THEMES = {
  light: {
    top: "#f4f8f7",
    bottom: "#d5e8e3",
    ink: "#10201d",
    muted: "#4b615c",
    accent: BRAND_COLOR,
  },
  dark: {
    top: "#12312c",
    bottom: "#0a1a18",
    ink: "#f2f7f6",
    muted: "#a9c2bc",
    accent: "#5fd6bf",
  },
  brand: {
    top: "#14917d",
    bottom: "#0b5f52",
    ink: "#ffffff",
    muted: "#d3ece6",
    accent: "#c9f5ea",
  },
};

interface Word {
  text: string;
  accent: boolean;
}

function words(text: string): Word[] {
  const result: Word[] = [];
  let accent = false;
  for (const part of text.split("*")) {
    for (const word of part.split(" ").filter((w) => w !== ""))
      result.push({ text: word, accent });
    accent = !accent;
  }
  return result;
}

/** Greedy line breaks for the font that is set on `ctx`. */
function wrap(ctx: SKRSContext2D, text: Word[], maxWidth: number): Word[][] {
  const space = ctx.measureText(" ").width;
  const lines: Word[][] = [];
  let line: Word[] = [];
  let width = 0;
  for (const word of text) {
    const w = ctx.measureText(word.text).width;
    if (line.length > 0 && width + space + w > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    width += (line.length > 0 ? space : 0) + w;
    line.push(word);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Draws `text` in lines from the baseline `y` on; returns the baseline after the last line. */
function drawText(
  ctx: SKRSContext2D,
  text: Word[],
  options: {
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    align: "center" | "left";
    color: string;
    accent: string;
  },
): number {
  const space = ctx.measureText(" ").width;
  let y = options.y;
  for (const line of wrap(ctx, text, options.maxWidth)) {
    const width =
      line.reduce((sum, word) => sum + ctx.measureText(word.text).width, 0) +
      space * (line.length - 1);
    let x = options.align === "center" ? options.x - width / 2 : options.x;
    for (const word of line) {
      ctx.fillStyle = word.accent ? options.accent : options.color;
      ctx.fillText(word.text, x, y);
      x += ctx.measureText(word.text).width + space;
    }
    y += options.lineHeight;
  }
  return y;
}

function background(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  theme: (typeof THEMES)[keyof typeof THEMES],
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.top);
  gradient.addColorStop(1, theme.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** A phone with `screen` in it, `width` wide with its top left corner at x, y. Returns its height. */
function drawPhone(
  ctx: SKRSContext2D,
  screen: Image,
  device: Device,
  x: number,
  y: number,
  width: number,
): number {
  const bezel = width * 0.024;
  const inner = width - bezel * 2;
  const innerHeight = (inner * screen.height) / screen.width;
  const height = innerHeight + bezel * 2;
  const radius = width * (device === "iphone" ? 0.14 : 0.1);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = width * 0.08;
  ctx.shadowOffsetY = width * 0.03;
  ctx.fillStyle = "#0c0d0f";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + bezel, y + bezel, inner, innerHeight, radius - bezel);
  ctx.clip();
  ctx.drawImage(screen, x + bezel, y + bezel, inner, innerHeight);
  ctx.restore();

  if (device === "iphone") {
    // The simulator's screenshot has no Dynamic Island.
    const w = inner * 0.29;
    const h = inner * 0.084;
    ctx.fillStyle = "#0c0d0f";
    ctx.beginPath();
    ctx.roundRect(x + width / 2 - w / 2, y + bezel + inner * 0.03, w, h, h / 2);
    ctx.fill();
  }
  return height;
}

function drawSlide(
  target: Target,
  slide: Slide,
  locale: Locale,
  screen: Image,
) {
  const { width, height } = target;
  const theme = THEMES[slide.theme];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  background(ctx, width, height, theme);

  const headSize = width * 0.082;
  ctx.font = `800 ${headSize}px Inter`;
  let y = drawText(ctx, words(slide.headline[locale]), {
    x: width / 2,
    y: height * 0.055 + headSize,
    maxWidth: width * 0.86,
    lineHeight: headSize * 1.1,
    align: "center",
    color: theme.ink,
    accent: theme.accent,
  });

  const subSize = width * 0.037;
  ctx.font = `500 ${subSize}px Inter`;
  y = drawText(ctx, words(slide.subline[locale]), {
    x: width / 2,
    y: y - headSize * 1.1 + headSize * 0.42 + subSize,
    maxWidth: width * 0.84,
    lineHeight: subSize * 1.3,
    align: "center",
    color: theme.muted,
    accent: theme.muted,
  });

  // As wide as fits completely; never narrower than 72 % of the image, which then cuts the phone
  // off at the bottom.
  const top = y - subSize * 1.3 + height * 0.035;
  const fit = ((height - top - height * 0.03) * screen.width) / screen.height;
  const phoneWidth = Math.min(width * 0.84, Math.max(width * 0.72, fit));
  drawPhone(
    ctx,
    screen,
    target.device,
    (width - phoneWidth) / 2,
    top,
    phoneWidth,
  );
  return canvas.toBuffer("image/png");
}

function drawFeature(device: Device, locale: Locale, screens: Image[]) {
  const width = 1024;
  const height = 500;
  const theme = THEMES.brand;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  background(ctx, width, height, theme);

  screens
    .slice(0, 2)
    .reverse()
    .forEach((screen, index) => {
      const front = index === 1;
      drawPhone(ctx, screen, device, front ? 590 : 780, front ? 56 : 104, 210);
    });

  const mark = 64;
  ctx.save();
  ctx.translate(64, 150);
  ctx.scale(mark / 256, mark / 256);
  ctx.fillStyle = "#ffffff";
  ctx.fill(logo, "evenodd");
  ctx.restore();

  ctx.fillStyle = theme.ink;
  ctx.font = "800 68px Inter";
  ctx.fillText("hauswart", 64 + mark + 16, 150 + 54);

  ctx.font = "500 30px Inter";
  drawText(ctx, words(feature.tagline[locale]), {
    x: 64,
    y: 290,
    maxWidth: 470,
    lineHeight: 40,
    align: "left",
    color: theme.muted,
    accent: theme.muted,
  });
  return canvas.toBuffer("image/png");
}

const targets: Target[] = [];
if (values.ios)
  targets.push({
    key: "ios-6.9",
    device: "iphone",
    source: values.ios,
    width: 1320,
    height: 2868,
  });
if (values.android)
  targets.push({
    key: "play-phone",
    device: "android",
    source: values.android,
    width: 1080,
    height: 1920,
  });

const locales: Locale[] = ["en", "de"];
let written = 0;
for (const target of targets) {
  for (const locale of locales) {
    const source = join(target.source, locale);
    if (!existsSync(source)) {
      console.warn(
        `skipped ${target.key}/${locale}: no screenshots in ${source}`,
      );
      continue;
    }
    const load = (screen: string) => loadImage(join(source, `${screen}.png`));
    const dir = join(outDir, target.key, locale);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [index, slide] of slides.entries()) {
      const file = `${String(index + 1).padStart(2, "0")}-${slide.id}.png`;
      const image = drawSlide(target, slide, locale, await load(slide.screen));
      await writeFile(join(dir, file), image);
      written++;
    }
    if (target.device === "android") {
      const dir = join(outDir, "play-feature");
      await mkdir(dir, { recursive: true });
      const screens = await Promise.all(feature.screens.map(load));
      await writeFile(
        join(dir, `${locale}.png`),
        drawFeature(target.device, locale, screens),
      );
      written++;
    }
  }
}
if (written === 0) {
  console.error("No screenshots found, nothing rendered.");
  process.exit(1);
}
console.log(`${written} images in ${outDir}`);
