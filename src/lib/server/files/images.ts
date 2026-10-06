import { createCanvas, loadImage } from "@napi-rs/canvas";
import { FileError } from "./errors";
import type { AllowedMime } from "./sniff";

/**
 * Image pipeline: decode, normalize orientation, strip metadata, cap size, re-encode, thumbnail.
 *
 * - `@napi-rs/canvas` (Skia) applies the EXIF orientation while decoding (verified for all eight
 *   values in the tests), so no manual orientation parsing is needed. Encoding writes pixels
 *   only: EXIF (including GPS), XMP, IPTC, comments, text chunks and the source's ICC profile
 *   are dropped (Skia adds its own generic sRGB profile to JPEGs). Colors of wide-gamut
 *   (Display P3) photos are therefore interpreted as sRGB.
 * - HEIC/HEIF cannot be decoded by Skia in this package (it supports png, jpeg, webp, gif, bmp,
 *   ico, avif), so HEIC uploads are rejected earlier with `unsupported_heic`.
 * - The pixel count is checked from the file header before decoding (decompression bombs).
 * - Animated WebP is reduced to its first frame.
 * - PDFs get no thumbnail for now (callers get `null`).
 */

export const MAX_INPUT_PIXELS = 50_000_000;
export const DEFAULT_MAX_DIMENSION = 4000;
export const THUMBNAIL_SIZE = 480;
const JPEG_QUALITY = 85;
const THUMB_QUALITY = 80;

export interface ProcessedImage {
  bytes: Buffer;
  mime: Extract<AllowedMime, `image/${string}`>;
  width: number;
  height: number;
  thumbnail: Buffer;
}

export interface ProcessImageOptions {
  maxDimension?: number;
  maxInputPixels?: number;
}

const corrupt = () => new FileError("corrupt_image");

export function readImageSize(
  bytes: Uint8Array,
  mime: AllowedMime,
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u8 = (i: number) => (i < bytes.length ? bytes[i]! : -1);
  let width: number;
  let height: number;

  if (mime === "image/png") {
    if (bytes.length < 24) throw corrupt();
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/jpeg") {
    let i = 2;
    for (;;) {
      while (u8(i) === 0xff && u8(i + 1) === 0xff) i++;
      if (u8(i) !== 0xff) throw corrupt();
      const marker = u8(i + 1);
      if (marker < 0) throw corrupt();
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) throw corrupt();
      if (i + 4 > bytes.length) throw corrupt();
      const length = view.getUint16(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (i + 9 > bytes.length) throw corrupt();
        height = view.getUint16(i + 5);
        width = view.getUint16(i + 7);
        break;
      }
      if (length < 2) throw corrupt();
      i += 2 + length;
    }
  } else if (mime === "image/webp") {
    if (bytes.length < 30) throw corrupt();
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X") {
      width = 1 + (u8(24) | (u8(25) << 8) | (u8(26) << 16));
      height = 1 + (u8(27) | (u8(28) << 8) | (u8(29) << 16));
    } else if (chunk === "VP8 ") {
      if (u8(23) !== 0x9d || u8(24) !== 0x01 || u8(25) !== 0x2a)
        throw corrupt();
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === "VP8L") {
      if (u8(20) !== 0x2f) throw corrupt();
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else {
      throw corrupt();
    }
  } else {
    throw corrupt();
  }

  if (width <= 0 || height <= 0) throw corrupt();
  return { width, height };
}

function fit(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function processImage(
  bytes: Uint8Array,
  mime: AllowedMime,
  options: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  if (mime === "application/pdf")
    throw new Error("processImage called with a pdf");
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxPixels = options.maxInputPixels ?? MAX_INPUT_PIXELS;

  const declared = readImageSize(bytes, mime);
  if (declared.width * declared.height > maxPixels) {
    throw new FileError("image_too_large");
  }

  let image;
  try {
    image = await loadImage(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  } catch {
    throw corrupt();
  }
  if (!(image.width > 0 && image.height > 0)) throw corrupt();
  if (image.width * image.height > maxPixels)
    throw new FileError("image_too_large");

  const target = fit(image.width, image.height, maxDimension);
  const canvas = createCanvas(target.width, target.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, target.width, target.height);

  let out: Buffer;
  let outMime: ProcessedImage["mime"];
  if (mime === "image/png") {
    out = await canvas.encode("png");
    outMime = "image/png";
  } else if (mime === "image/webp") {
    out = await canvas.encode("webp", JPEG_QUALITY);
    outMime = "image/webp";
  } else {
    out = await canvas.encode("jpeg", JPEG_QUALITY);
    outMime = "image/jpeg";
  }

  const thumbTarget = fit(image.width, image.height, THUMBNAIL_SIZE);
  const thumbCanvas = createCanvas(thumbTarget.width, thumbTarget.height);
  const thumbCtx = thumbCanvas.getContext("2d");
  thumbCtx.imageSmoothingQuality = "high";
  thumbCtx.drawImage(image, 0, 0, thumbTarget.width, thumbTarget.height);
  const thumbnail = await thumbCanvas.encode("webp", THUMB_QUALITY);

  return {
    bytes: out,
    mime: outMime,
    width: target.width,
    height: target.height,
    thumbnail,
  };
}
