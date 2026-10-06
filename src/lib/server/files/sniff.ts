import { FileError } from "./errors";

export const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMime = (typeof ALLOWED_MIMES)[number];

export interface Sniffed {
  mime: AllowedMime;
  ext: "jpg" | "png" | "webp" | "pdf";
}

const EXT: Record<AllowedMime, Sniffed["ext"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extFor(mime: AllowedMime): Sniffed["ext"] {
  return EXT[mime];
}

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIMES as readonly string[]).includes(mime);
}

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
]);
const GENERIC_HEIF_BRANDS = new Set(["mif1", "msf1", "heif"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < Math.min(end, bytes.length); i++)
    out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Detects the type from magic bytes only; the filename and any client supplied mime are never
 * trusted. Throws `FileError`: `unsupported_heic` for HEIC/HEIF (no decoder is available, see
 * images.ts), `unsupported_type` for everything else outside the allowlist (GIF, SVG, HTML,
 * AVIF, ...).
 *
 * The PDF header must be at offset 0 (stricter than the spec's first 1024 bytes, which keeps
 * polyglot files out).
 */
export function sniffMime(bytes: Uint8Array): Sniffed {
  if (bytes.length === 0) throw new FileError("empty");

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { mime: "application/pdf", ext: "pdf" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brands = [ascii(bytes, 8, 12)];
    const boxSize =
      ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>>
      0;
    const end = Math.min(boxSize, bytes.length, 64);
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, i + 4));
    const isHeic =
      brands.some((brand) => HEIC_BRANDS.has(brand)) ||
      (brands.some((brand) => GENERIC_HEIF_BRANDS.has(brand)) &&
        !brands.some((brand) => AVIF_BRANDS.has(brand)));
    if (isHeic) {
      throw new FileError(
        "unsupported_heic",
        "HEIC/HEIF is not supported; export as JPEG",
      );
    }
  }
  throw new FileError("unsupported_type");
}
