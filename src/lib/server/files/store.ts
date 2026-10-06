import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { FileError } from "./errors";
import { sanitizeFilename, withExtension } from "./filename";
import { processImage } from "./images";
import { extFor, sniffMime, type AllowedMime } from "./sniff";

/**
 * Content-addressed file store.
 *
 * Layout: `<root>/<first two hex chars>/<sha256>` for the stored bytes and
 * `<root>/<xx>/<sha256>.thumb.webp` for the 480 px thumbnail of images. The sha256 is that of the
 * bytes actually stored: images are re-encoded (metadata stripped, orientation normalized, size
 * capped) before hashing, PDFs are stored as uploaded. Files carry no extension on disk; the
 * mime type lives in the database row (`mime` of the `putFile` result).
 */

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const PATH_RE = /^([0-9a-f]{2})\/([0-9a-f]{64})(\.thumb\.webp)?$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export interface PutFileOptions {
  filename: string;
  /** Client supplied mime type. Never trusted; a mismatch is only logged. */
  declaredMime?: string;
  /** Default 25 MiB. */
  maxBytes?: number;
  /** Receives mismatch warnings. Defaults to `console.warn`. */
  log?: (message: string, meta: Record<string, string>) => void;
}

export interface StoredFile {
  sha256: string;
  /** `ab/<sha256>`, relative to the root. */
  path: string;
  size: number;
  mime: AllowedMime;
  ext: "jpg" | "png" | "webp" | "pdf";
  /** Sanitized upload name with an extension that matches the detected type. */
  filename: string;
  width: number | null;
  height: number | null;
  /** `ab/<sha256>.thumb.webp` for images, `null` for PDFs (no thumbnails yet). */
  thumbPath: string | null;
}

export function defaultFilesRoot(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolve(env.HAUSWART_FILES_DIR || "./data/files");
}

export function isValidStorePath(path: string): boolean {
  const match = PATH_RE.exec(path);
  return match !== null && match[2]!.startsWith(match[1]!);
}

function resolveInside(root: string, path: string): string {
  if (!isValidStorePath(path)) throw new FileError("invalid_path");
  const base = resolve(root);
  const full = resolve(base, path);
  if (!full.startsWith(base + sep)) throw new FileError("invalid_path");
  return full;
}

function shardPath(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256}`;
}

async function exists(path: string, size: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Writes via a temp file in the target directory and renames it into place. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    try {
      await unlink(temp);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("file store: could not remove temp file", {
          code: (cleanupError as NodeJS.ErrnoException).code,
        });
      }
    }
    throw error;
  }
}

async function ensureWritten(path: string, bytes: Uint8Array): Promise<void> {
  if (await exists(path, bytes.byteLength)) {
    const now = new Date();
    await utimes(path, now, now);
    return;
  }
  await writeAtomic(path, bytes);
}

/**
 * Validates, sanitizes and stores an upload. Rejects with `FileError` (`empty`, `too_large`,
 * `unsupported_type`, `unsupported_heic`, `corrupt_image`, `image_too_large`). Identical content
 * is stored once; storing it again only refreshes its modification time (see
 * `deleteIfUnreferenced`). Nothing is left behind when an error occurs.
 */
export async function putFile(
  root: string,
  bytes: Uint8Array,
  options: PutFileOptions,
): Promise<StoredFile> {
  if (bytes.byteLength === 0) throw new FileError("empty");
  if (bytes.byteLength > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
    throw new FileError("too_large");
  }
  const sniffed = sniffMime(bytes);
  if (
    options.declaredMime &&
    options.declaredMime.toLowerCase() !== sniffed.mime
  ) {
    (options.log ?? console.warn)("declared mime type does not match content", {
      declared: options.declaredMime.slice(0, 100),
      detected: sniffed.mime,
    });
  }

  let stored: Uint8Array = bytes;
  let mime: AllowedMime = sniffed.mime;
  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Uint8Array | null = null;
  if (sniffed.mime !== "application/pdf") {
    const image = await processImage(bytes, sniffed.mime);
    stored = image.bytes;
    mime = image.mime;
    width = image.width;
    height = image.height;
    thumbnail = image.thumbnail;
  }

  const sha256 = createHash("sha256").update(stored).digest("hex");
  const path = shardPath(sha256);
  const ext = extFor(mime);
  await ensureWritten(resolveInside(root, path), stored);

  let thumbPath: string | null = null;
  if (thumbnail) {
    thumbPath = `${path}.thumb.webp`;
    await ensureWritten(resolveInside(root, thumbPath), thumbnail);
  }

  return {
    sha256,
    path,
    size: stored.byteLength,
    mime,
    ext,
    filename: withExtension(
      sanitizeFilename(options.filename),
      ext,
      ext === "jpg" ? ["jpeg"] : [],
    ),
    width,
    height,
    thumbPath,
  };
}

/**
 * Returns the stored file, `null` when it does not exist, and throws
 * `FileError('invalid_path')` for anything that is not exactly `ab/<64 hex>` (optionally with
 * `.thumb.webp`) — no traversal, no absolute paths, no other suffixes. Symlinks and
 * directories are treated as missing.
 */
export async function openFile(
  root: string,
  path: string,
): Promise<ReturnType<typeof Bun.file> | null> {
  const full = resolveInside(root, path);
  try {
    const info = await lstat(full);
    if (!info.isFile()) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return Bun.file(full);
}

export interface DeleteOptions {
  /**
   * Only delete files not modified for this long (default 60 s). `putFile` refreshes the
   * modification time of deduplicated files, so a file that was just re-uploaded and whose
   * database row is not committed yet survives a concurrent sweep.
   */
  minAgeMs?: number;
  now?: number;
}

/**
 * Deletes a stored file and its thumbnail when `isReferenced(sha256)` is false. Returns whether
 * the files were removed.
 */
export async function deleteIfUnreferenced(
  root: string,
  sha256: string,
  isReferenced: (sha256: string) => boolean | Promise<boolean>,
  options: DeleteOptions = {},
): Promise<boolean> {
  if (!SHA_RE.test(sha256)) throw new FileError("invalid_path");
  const path = resolveInside(root, shardPath(sha256));
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const minAge = options.minAgeMs ?? 60_000;
  if ((options.now ?? Date.now()) - info.mtimeMs < minAge) return false;
  if (await isReferenced(sha256)) return false;

  for (const target of [path, `${path}.thumb.webp`]) {
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return true;
}

export function pathFor(sha256: string): string {
  if (!SHA_RE.test(sha256)) throw new FileError("invalid_path");
  return shardPath(sha256);
}
