import { z } from "zod";
import { ATTACHMENT_OWNER_TYPES } from "../enums";
import {
  atLeastOne,
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
