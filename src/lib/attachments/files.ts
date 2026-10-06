import { resolve } from "$app/paths";
import { MAX_ATTACHMENT_BYTES } from "$lib/api/schemas/attachments";
import type { Attachment } from "$lib/api/schemas/attachments";
import { getLocale } from "$lib/paraglide/runtime";

export const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export { MAX_ATTACHMENT_BYTES };

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function isHeic(file: Pick<File, "name" | "type">): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** The type of a file as far as the browser tells; falls back to the extension. */
export function fileType(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) || "";
}

/** Whether the file matches an `accept`-style list (`image/jpeg,application/pdf`, `image/*`). */
export function matchesAccept(
  file: Pick<File, "name" | "type">,
  accept: string,
): boolean {
  const type = fileType(file);
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) =>
      token.endsWith("/*")
        ? type.startsWith(token.slice(0, -1))
        : type === token,
    );
}

export function isImage(attachment: Pick<Attachment, "mime">): boolean {
  return attachment.mime.startsWith("image/");
}

export function isPdf(attachment: Pick<Attachment, "mime">): boolean {
  return attachment.mime === "application/pdf";
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 1536 -> "1.5 KB" in the current language. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(
    getLocale() === "de" ? "de-CH" : "en-GB",
    {
      maximumFractionDigits: unit === 0 ? 0 : 1,
    },
  ).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

/** The file name without its extension, for a default alt text. */
export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/** The content URL of an attachment (the API's own path, which `resolve` leaves alone). */
export function contentHref(attachment: Pick<Attachment, "url">) {
  return resolve(attachment.url as "/");
}

/** The content URL as a download (`?download=1`). */
export function downloadHref(attachment: Pick<Attachment, "url">) {
  const sep = attachment.url.includes("?") ? "&" : "?";
  return resolve(`${attachment.url}${sep}download=1` as "/");
}
