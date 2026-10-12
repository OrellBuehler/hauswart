import { createCanvas, loadImage } from "@napi-rs/canvas";
import { FileError } from "./errors";

/**
 * A smaller copy of a stored image for something that reads it rather than looks at it (an assistant): the stored image
 * is capped at 4000 px, which is more than a model needs and more than a tool result should carry.
 *
 * - An image that already fits (its size is what `previewSize` would make of it, and it is small enough) is returned
 *   as stored, byte for byte.
 * - Any other is drawn on white (a PNG with transparency must not turn black) at `previewSize` and encoded as JPEG,
 *   at a lower quality and then a smaller size until it fits in `maxBytes`.
 */

export interface PreviewOptions {
  /** The longest side, in pixels. */
  maxSide: number;
  /** The most bytes of the result. */
  maxBytes: number;
}

export interface PreviewSource {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface PreviewImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  /** False when the stored bytes are returned unchanged. */
  scaled: boolean;
}

const QUALITIES = [82, 72, 62, 52];
const SHRINK = 0.8;
const MAX_SHRINKS = 6;
/** A very long, narrow receipt keeps this many times `maxSide` on its long side ... */
const LONG_SIDE_FACTOR = 2;
/** ... so that its short side stays at least this share of `maxSide` (600 of 1600 px) and the print stays legible. */
const SHORT_SIDE_SHARE = 0.375;

/**
 * Where an image of this size ends up: its longest side at `maxSide` (never enlarged), except for a long, narrow image
 * (a till receipt), which would come out too thin to read; that keeps a short side of `SHORT_SIDE_SHARE` of `maxSide`
 * (or its own), up to a long side of twice `maxSide`.
 */
export function previewSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let scale = Math.min(1, maxSide / long);
  const minShort = maxSide * SHORT_SIDE_SHARE;
  if (short * scale < minShort) {
    scale = Math.min(1, minShort / short, (LONG_SIDE_FACTOR * maxSide) / long);
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function previewImage(
  source: PreviewSource,
  options: PreviewOptions,
): Promise<PreviewImage> {
  const target = previewSize(source.width, source.height, options.maxSide);
  if (
    target.width === source.width &&
    target.height === source.height &&
    source.bytes.byteLength <= options.maxBytes
  ) {
    return { ...source, scaled: false };
  }

  let image;
  try {
    image = await loadImage(
      Buffer.from(
        source.bytes.buffer,
        source.bytes.byteOffset,
        source.bytes.byteLength,
      ),
    );
  } catch {
    throw new FileError("corrupt_image");
  }

  let size = target;
  let result: PreviewImage | null = null;
  for (let shrinks = 0; shrinks <= MAX_SHRINKS; shrinks++) {
    const canvas = createCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, size.width, size.height);
    for (const quality of QUALITIES) {
      const out = await canvas.encode("jpeg", quality);
      result = { bytes: out, mime: "image/jpeg", ...size, scaled: true };
      if (out.byteLength <= options.maxBytes) return result;
    }
    size = {
      width: Math.max(1, Math.round(size.width * SHRINK)),
      height: Math.max(1, Math.round(size.height * SHRINK)),
    };
  }
  // Pathological noise: the smallest attempt is still the best there is.
  return result as PreviewImage;
}
