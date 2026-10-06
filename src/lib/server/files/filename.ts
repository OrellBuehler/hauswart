const MAX_NAME_LENGTH = 120;
const MAX_EXT_LENGTH = 10;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// C0/C1 controls, bidi controls and overrides, zero-width and line/paragraph separators, BOM
/* eslint-disable no-control-regex */
const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */
const RESERVED_FS_CHARS = /[<>:"|?*\\/]/g;

function truncateCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

/**
 * Makes an untrusted upload filename safe to store and to put into Content-Disposition:
 * strips directory components (both separators), control and bidi characters, reserved
 * file-system characters, leading dots/spaces and trailing dots/spaces, normalizes to NFC, and
 * limits the length to 120 characters while keeping the extension. Returns `fallback` when
 * nothing usable is left.
 */
export function sanitizeFilename(name: string, fallback = "file"): string {
  let value = name.normalize("NFC").replace(UNSAFE_CHARS, "");
  value = value.split(/[\\/]/).pop() ?? "";
  value = value
    .replace(RESERVED_FS_CHARS, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  const dot = value.lastIndexOf(".");
  let base = dot > 0 ? value.slice(0, dot) : value;
  let ext = dot > 0 ? value.slice(dot) : "";
  if ([...ext].length - 1 > MAX_EXT_LENGTH) {
    base = value;
    ext = "";
  }
  base = truncateCodePoints(base, MAX_NAME_LENGTH - [...ext].length).replace(
    /[.\s]+$/,
    "",
  );
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;

  const result = `${base}${ext}`;
  return base.length === 0 ? fallback : result;
}

const KNOWN_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "avif",
  "svg",
  "bmp",
  "tif",
  "tiff",
  "pdf",
  "html",
  "htm",
]);

/**
 * Makes the extension of a sanitized filename match the detected type: a matching extension (or
 * alias such as `jpeg`) is kept, another well-known media extension is replaced, anything else
 * is kept and the detected extension appended.
 */
export function withExtension(
  filename: string,
  ext: string,
  aliases: readonly string[] = [],
): string {
  const dot = filename.lastIndexOf(".");
  const current = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (current === ext || aliases.includes(current)) return filename;
  const base = KNOWN_EXTENSIONS.has(current)
    ? filename.slice(0, dot)
    : filename;
  return `${base}.${ext}`;
}

const TRANSLITERATE: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

function asciiFallback(filename: string): string {
  return filename
    .replace(/[äöüÄÖÜß]/g, (char) => TRANSLITERATE[char]!)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\%]/g, "_");
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds a Content-Disposition header value with an ASCII `filename` fallback and an RFC 5987
 * `filename*` for the real name. The name is sanitized again, so any string is safe to pass.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  const fallback = asciiFallback(safe);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}
