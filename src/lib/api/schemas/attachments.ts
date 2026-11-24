import { z } from "zod";
import { ATTACHMENT_OWNER_TYPES } from "../enums";
import {
  atLeastOne,
  httpUrlSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";

export const attachmentOwnerTypeSchema = z.enum(ATTACHMENT_OWNER_TYPES);

export const CAPTION_MAX = 500;
/** Largest upload (the file itself, after which the request is refused with 413). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Request body limit of the upload endpoint: the file plus the multipart envelope. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

export const attachmentSchema = z
  .object({
    id: z.string(),
    ownerType: attachmentOwnerTypeSchema,
    ownerId: z.string(),
    filename: z.string(),
    mime: z.string(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    caption: z.string().nullable(),
    guestVisible: z.boolean(),
    /** `GET` this for the file (images and PDFs inline; add `?download=1` to save). */
    url: z.string(),
    /** 480 px WebP thumbnail of images; null for PDFs. */
    thumbUrl: z.string().nullable(),
    uploadedBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Attachment" });
export type Attachment = z.infer<typeof attachmentSchema>;

/** Multipart form fields (all values arrive as strings except `file`). */
export const uploadAttachmentRequestSchema = z.strictObject({
  file: z.file(),
  ownerType: attachmentOwnerTypeSchema,
  ownerId: idSchema,
  caption: z.string().trim().max(CAPTION_MAX).optional(),
  guestVisible: queryBooleanSchema.optional(),
});
export type UploadAttachmentRequest = z.output<
  typeof uploadAttachmentRequestSchema
>;

/** The longest address `POST /attachments/from-url` takes. */
export const ATTACH_URL_MAX = 2000;

/**
 * Why `POST /attachments/from-url` could not get the file, as `details.code` of the 400 on `url`: `blocked_host` (the
 * address, or where a redirect led, is not a public one on a standard port), `unreachable` (no answer: the name does not
 * resolve, the connection or the TLS handshake failed, or the time ran out), `upstream_status` (the server answered
 * with an error; `details.status`), `too_large` (more than 25 MiB) and `too_many_redirects` (more than 3).
 */
export const FROM_URL_ERROR_CODES = [
  "blocked_host",
  "unreachable",
  "upstream_status",
  "too_large",
  "too_many_redirects",
] as const;

/** JSON body of `POST /attachments/from-url`: the owner as for an upload, and the address of the file. */
export const attachFromUrlRequestSchema = z.strictObject({
  ownerType: attachmentOwnerTypeSchema,
  ownerId: idSchema,
  url: httpUrlSchema(ATTACH_URL_MAX),
  caption: z.string().trim().max(CAPTION_MAX).optional(),
  guestVisible: z.boolean().optional(),
});
export type AttachFromUrlRequest = z.output<typeof attachFromUrlRequestSchema>;

export const listAttachmentsQuerySchema = paginationQuerySchema.extend({
  ownerType: attachmentOwnerTypeSchema,
  ownerId: idSchema,
});
export const listAttachmentsResponseSchema = paginated(attachmentSchema);

export const updateAttachmentRequestSchema = atLeastOne(
  z.strictObject({
    caption: nullableText(CAPTION_MAX).optional(),
    guestVisible: z.boolean().optional(),
  }),
);
export type UpdateAttachmentRequest = z.output<
  typeof updateAttachmentRequestSchema
>;

const flagSchema = z
  .enum(["0", "1", "true", "false"])
  .transform((value) => value === "1" || value === "true");

export const attachmentContentQuerySchema = z.object({
  /** `1` serves the file as a download instead of inline. */
  download: flagSchema.optional(),
});

/** Content types an attachment is served as (everything else would be `application/octet-stream`). */
export const ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Content types of `GET /attachments/{id}/preview`: an image is sent as JPEG when it had to be scaled down, else as stored. */
export const ATTACHMENT_PREVIEW_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** The longest side of the scaled copy of an image an assistant reads, in pixels (more for a very long, narrow image). */
export const ATTACHMENT_PREVIEW_MAX_SIDE = 1600;
/** The most bytes of that copy. */
export const ATTACHMENT_PREVIEW_MAX_BYTES = 1_500_000;

/**
 * The largest PDF the preview sends whole, and the most an assistant is handed through the MCP connection in one answer
 * (it is embedded in the result, and base64 makes it a third larger). A bigger one is read a range of pages at a time.
 */
export const ATTACHMENT_PDF_READ_MAX_BYTES = 4 * 1024 * 1024;

/** The most pages one preview request returns. */
export const ATTACHMENT_PREVIEW_MAX_PAGES = 20;

/** The header of the preview of a PDF that says how many pages the whole stored file has. */
export const PAGE_COUNT_HEADER = "X-Page-Count";

/**
 * Why `GET /attachments/{id}/preview` refused, as `details.code` of the 400: `too_large` (a PDF over 4 MiB asked for without
 * `pages`; `details.pageCount` is the number of its pages), `unreadable` (the PDF cannot be opened, say because it is
 * encrypted or damaged), `out_of_range` (a page beyond the end; `details.pageCount`) and `not_a_pdf` (`pages` for a file that
 * has none).
 */
export const PREVIEW_ERROR_CODES = [
  "too_large",
  "unreadable",
  "out_of_range",
  "not_a_pdf",
] as const;

/** The pages a preview is asked for: the first and the last one, 1-based and both included. */
export interface PageRange {
  first: number;
  last: number;
}

const PAGES_PATTERN = /^([1-9]\d{0,3})(?:-([1-9]\d{0,3}))?$/;

/** `"3"` is page 3, `"3-8"` is pages 3 to 8; null for anything else, a backwards range and a range of more than 20 pages. */
export function parsePageRange(pages: string): PageRange | null {
  const match = PAGES_PATTERN.exec(pages.trim());
  if (!match) return null;
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  if (last < first || last - first + 1 > ATTACHMENT_PREVIEW_MAX_PAGES) {
    return null;
  }
  return { first, last };
}

export const attachmentPreviewQuerySchema = z.object({
  /** For a PDF: `3` or `3-8` (at most 20 pages). The answer is a PDF of only those pages. */
  pages: z
    .string()
    .trim()
    .refine((pages) => parsePageRange(pages) !== null, {
      error: `Give a page ("3") or a range of at most ${ATTACHMENT_PREVIEW_MAX_PAGES} pages ("3-8"), counted from 1.`,
    })
    .optional(),
});
