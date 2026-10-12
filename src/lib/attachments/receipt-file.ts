import { m } from "$lib/paraglide/messages";
import { MAX_ATTACHMENT_BYTES, isHeic, matchesAccept } from "./files";

/** What the server stores as a receipt: the types of any attachment. */
export const RECEIPT_TYPES = "image/jpeg,image/png,image/webp,application/pdf";
/**
 * The file picker offers every image, not only the three types the server stores, so that a HEIC photo can be chosen and
 * turned into a JPEG here. Whatever the server would refuse is refused with a clear message after the choice.
 */
export const RECEIPT_PICK_ACCEPT = "image/*,application/pdf";
/** The camera button: a photo straight from the back camera. */
export const RECEIPT_CAMERA_ACCEPT = "image/*";

/** The longest side of a photo converted from HEIC; the server scales it down further. */
export const CONVERTED_MAX_SIDE = 4096;
export const CONVERTED_JPEG_QUALITY = 0.9;

export type ReceiptProblem =
  "empty" | "too_large" | "unsupported_type" | "heic";

export type ReceiptFile =
  | { ok: true; file: File; converted: boolean }
  | { ok: false; problem: ReceiptProblem };

/** Draws a picture the browser can decode and encodes it as JPEG; throws for a picture it cannot decode. */
export type JpegConverter = (file: File) => Promise<Blob>;

/** What to do with a file the person chose, as far as its name and type tell. */
export type HeicPlan = "keep" | "convert" | "refuse";

/**
 * A HEIC photo (iPhone camera roll) is converted when this browser can decode it - Safari does, Chrome and Firefox do not
 * - and refused with the server's own wording otherwise. Everything else is kept as it is.
 */
export function heicPlan(
  file: Pick<File, "name" | "type">,
  canConvert: boolean,
): HeicPlan {
  if (!isHeic(file)) return "keep";
  return canConvert ? "convert" : "refuse";
}

/** `IMG_0001.HEIC` -> `IMG_0001.jpg`. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "photo"}.jpg`;
}

/** The size of a picture scaled down to at most `max` pixels on the longest side (never up); at least 1 pixel each. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Checks a chosen file and, for HEIC, converts it. `convert` is `null` where the browser has no way to decode pictures
 * at all. A conversion that throws is the browser saying it cannot decode HEIC: that is the same answer as no converter.
 */
export async function prepareReceiptFile(
  file: File,
  convert: JpegConverter | null,
): Promise<ReceiptFile> {
  if (file.size === 0) return { ok: false, problem: "empty" };
  let chosen = file;
  let converted = false;
  switch (heicPlan(file, convert !== null)) {
    case "refuse":
      return { ok: false, problem: "heic" };
    case "convert":
      try {
        const blob = await convert!(file);
        chosen = new File([blob], jpegName(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
        converted = true;
      } catch (err) {
        console.warn(
          "receipt photo could not be converted",
          err instanceof Error ? err.name : "unknown",
        );
        return { ok: false, problem: "heic" };
      }
      break;
    case "keep":
      break;
  }
  if (!matchesAccept(chosen, RECEIPT_TYPES)) {
    return { ok: false, problem: "unsupported_type" };
  }
  if (chosen.size === 0) return { ok: false, problem: "empty" };
  if (chosen.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, problem: "too_large" };
  }
  return { ok: true, file: chosen, converted };
}

/** The wording for a refused file; the same sentences the upload endpoint's own refusals get. */
export function receiptProblemMessage(problem: ReceiptProblem): string {
  switch (problem) {
    case "empty":
      return m.attach_error_empty();
    case "too_large":
      return m.attach_error_too_large();
    case "unsupported_type":
      return m.attach_error_unsupported_type();
    case "heic":
      return m.attach_error_heic();
  }
}
