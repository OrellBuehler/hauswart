import { z } from "zod";
import { DOC_SECTIONS } from "../enums";
import {
  idSchema,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
  slugSchema,
} from "./common";

export const docSectionSchema = z.enum(DOC_SECTIONS);

export const PAGE_TITLE_MAX = 200;
/** `POST /pages/preview` is a static route, so a page with this slug could not be fetched. */
export const RESERVED_PAGE_SLUGS = ["preview"] as const;

export const pageSlugSchema = slugSchema.refine(
  (slug) => !(RESERVED_PAGE_SLUGS as readonly string[]).includes(slug),
  { error: "This slug is reserved." },
);

export const headingSchema = z
  .object({
    level: z.number().int().min(1).max(6),
    text: z.string(),
    /** Anchor id on the rendered heading (`h-…`). */
    id: z.string(),
  })
  .meta({ id: "Heading" });
export type Heading = z.infer<typeof headingSchema>;

export const docPageSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    section: docSectionSchema,
    assetId: z.string().nullable(),
    roomId: z.string().nullable(),
    sortOrder: z.number().int(),
    guestVisible: z.boolean(),
    pinned: z.boolean(),
    rev: z.number().int(),
    /** First 160 characters of the page text, secrets excluded. */
    excerpt: z.string(),
    updatedBy: z.string().nullable(),
    updatedByName: z.string().nullable(),
    archivedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "DocPageSummary" });
export type DocPageSummary = z.infer<typeof docPageSummarySchema>;

export const backlinkSchema = z
  .object({ id: z.string(), slug: z.string(), title: z.string() })
  .meta({ id: "PageBacklink" });

export const docPageSchema = docPageSummarySchema
  .extend({
    bodyMd: z.string(),
    /** Sanitized HTML for members: secret blocks included. */
    renderedHtml: z.string(),
    headings: z.array(headingSchema),
    /** Pages that link here with `[[slug]]`. */
    backlinks: z.array(backlinkSchema),
  })
  .meta({ id: "DocPage" });
export type DocPage = z.infer<typeof docPageSchema>;

export const listPagesQuerySchema = paginationQuerySchema.extend({
  section: docSectionSchema.optional(),
  assetId: idSchema.optional(),
  roomId: idSchema.optional(),
  /** Full-text search over title and text (best match first). */
  q: z.string().trim().min(1).max(100).optional(),
  pinned: queryBooleanSchema.optional(),
  includeArchived: queryBooleanSchema.optional(),
});
export const listPagesResponseSchema = paginated(docPageSummarySchema);

export const pageParamsSchema = z.object({
  slug: z.string().min(1).max(200),
});

const pageFields = {
  title: z.string().trim().min(1).max(PAGE_TITLE_MAX),
  section: docSectionSchema,
  assetId: idSchema.nullable(),
  roomId: idSchema.nullable(),
  bodyMd: z.string(),
  sortOrder: z.number().int().min(0).max(100_000),
  guestVisible: z.boolean(),
  pinned: z.boolean(),
};

/** `slug` is derived from the title when omitted. */
export const createPageRequestSchema = z.strictObject({
  title: pageFields.title,
  slug: pageSlugSchema.optional(),
  section: pageFields.section.default("general"),
  assetId: pageFields.assetId.optional(),
  roomId: pageFields.roomId.optional(),
  bodyMd: pageFields.bodyMd.default(""),
  sortOrder: pageFields.sortOrder.optional(),
  guestVisible: pageFields.guestVisible.default(false),
  pinned: pageFields.pinned.default(false),
});
export type CreatePageRequest = z.output<typeof createPageRequestSchema>;

export const updatePageRequestSchema = z
  .strictObject({
    /** The revision the client edited; a mismatch is a 409 `conflict` with the current `rev`. */
    rev: z.number().int().min(1),
    title: pageFields.title.optional(),
    slug: pageSlugSchema.optional(),
    section: pageFields.section.optional(),
    assetId: pageFields.assetId.optional(),
    roomId: pageFields.roomId.optional(),
    bodyMd: pageFields.bodyMd.optional(),
    sortOrder: pageFields.sortOrder.optional(),
    guestVisible: pageFields.guestVisible.optional(),
    pinned: pageFields.pinned.optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "rev"), {
    error: "Provide at least one field to update.",
  });
export type UpdatePageRequest = z.output<typeof updatePageRequestSchema>;

export const pageRevisionSummarySchema = z
  .object({
    rev: z.number().int(),
    title: z.string(),
    /** UTF-8 bytes of the markdown. */
    size: z.number().int(),
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    createdAt: isoTimestampSchema,
  })
  .meta({ id: "PageRevisionSummary" });

export const pageRevisionSchema = pageRevisionSummarySchema
  .extend({ bodyMd: z.string() })
  .meta({ id: "PageRevision" });

export const listRevisionsResponseSchema = z.object({
  items: z.array(pageRevisionSummarySchema),
});

export const pageRevisionParamsSchema = z.object({
  slug: z.string().min(1).max(200),
  rev: z.coerce.number().int().min(1),
});

export const previewPageRequestSchema = z.strictObject({
  bodyMd: z.string(),
});
export const previewPageResponseSchema = z.object({
  /** Sanitized HTML as a member sees it (secret blocks shown). */
  html: z.string(),
  headings: z.array(headingSchema),
});
