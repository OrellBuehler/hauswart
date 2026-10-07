import { z } from "zod";
import {
  DOCUMENT_LINK_OWNER_TYPES,
  DOCUMENT_LINK_ROLES,
  DOCUMENT_PROVIDERS,
  DOCUMENT_UPLOAD_STATUSES,
} from "../enums";
import {
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";

export const documentProviderSchema = z.enum(DOCUMENT_PROVIDERS);
export const documentLinkRoleSchema = z.enum(DOCUMENT_LINK_ROLES);
export const documentLinkOwnerTypeSchema = z.enum(DOCUMENT_LINK_OWNER_TYPES);

/** The id of a document in its provider (positive integer; arrives as text in a path). */
export const externalDocumentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const documentParamsSchema = z.object({
  provider: documentProviderSchema,
  externalId: externalDocumentIdSchema,
});

const providerId = z.number().int().positive();

/**
 * The settings of a connection to a document provider (`config` of `PUT /integrations/{kind}`).
 * Every id is a choice of the person, never a constant of the code; unknown keys are dropped.
 */
export const documentProviderConfigSchema = z.object({
  /** Documents with one of these tags are the household's documents: they are synced and searchable. */
  sharedTagIds: z.array(providerId).max(50).default([]),
  /** The date field that holds "warranty until". */
  warrantyFieldId: providerId.nullish(),
  /** The date field that holds "warranty extended until". */
  warrantyExtendedFieldId: providerId.nullish(),
  /** Tags given to documents pushed from hauswart. */
  uploadTagIds: z.array(providerId).max(50).default([]),
  uploadStoragePathId: providerId.nullish(),
  uploadCorrespondentId: providerId.nullish(),
  /** Groups that may view and change a document after it was pushed, so the rest of the household sees it. */
  shareGroupIds: z.array(providerId).max(50).default([]),
  /** Documents with one of these tags are receipts: with a warranty date they are suggested as inventory. */
  receiptTagIds: z.array(providerId).max(50).default([]),
  /** Documents with one of these tags are manuals. */
  manualTagIds: z.array(providerId).max(50).default([]),
  /** Add a note with the hauswart link to a document when it is linked. */
  writeBackNotes: z.boolean().default(false),
  /** The public address of this app, for links in notes; defaults to the server's `ORIGIN`. */
  appUrl: z.string().trim().max(500).optional(),
});
export type DocumentProviderConfig = z.output<
  typeof documentProviderConfigSchema
>;

/** Where a linked document is used (the owner's title is null when it is gone or unreadable). */
export const documentLinkSummarySchema = z
  .object({
    linkId: z.string(),
    ownerType: documentLinkOwnerTypeSchema,
    ownerId: z.string(),
    ownerTitle: z.string().nullable(),
    /** App path of the owner, or null when it is gone. */
    ownerUrl: z.string().nullable(),
    role: documentLinkRoleSchema,
  })
  .meta({ id: "DocumentLinkSummary" });

export const externalDocumentSchema = z
  .object({
    provider: documentProviderSchema,
    externalId: z.number().int(),
    title: z.string(),
    /** The date on the document (not when it was uploaded). */
    createdDate: dateSchema.nullable(),
    correspondentId: z.number().int().nullable(),
    correspondentName: z.string().nullable(),
    tagIds: z.array(z.number().int()),
    tagNames: z.array(z.string()),
    mimeType: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    noteCount: z.number().int(),
    warrantyUntil: dateSchema.nullable(),
    warrantyExtendedUntil: dateSchema.nullable(),
    /** Where hauswart uses it; empty when it is linked nowhere. */
    linkedTo: z.array(documentLinkSummarySchema),
    /** Proxied through the caller's own account; usable as `<img src>` and links with the session cookie. */
    thumbUrl: z.string(),
    previewUrl: z.string(),
    downloadUrl: z.string(),
  })
  .meta({ id: "ExternalDocument" });
export type ExternalDocument = z.infer<typeof externalDocumentSchema>;

export const documentLinkSchema = z
  .object({
    id: z.string(),
    provider: documentProviderSchema,
    externalId: z.number().int(),
    ownerType: documentLinkOwnerTypeSchema,
    ownerId: z.string(),
    ownerTitle: z.string().nullable(),
    /** App path of the owner, or null when it is gone. */
    ownerUrl: z.string().nullable(),
    role: documentLinkRoleSchema,
    label: z.string().nullable(),
    /** Whether the caller's own account can read the document. False: it is not shared with them. */
    available: z.boolean(),
    /** What the caller's account knows of the document; null when it is not available. */
    document: z
      .object({
        title: z.string(),
        createdDate: dateSchema.nullable(),
        correspondentName: z.string().nullable(),
        mimeType: z.string().nullable(),
        pageCount: z.number().int().nullable(),
        tagNames: z.array(z.string()),
      })
      .nullable(),
    thumbUrl: z.string().nullable(),
    previewUrl: z.string().nullable(),
    downloadUrl: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "DocumentLink" });
export type DocumentLink = z.infer<typeof documentLinkSchema>;

export const documentDetailSchema = externalDocumentSchema
  .extend({
    /** The document in the provider's own web app, on the caller's address. */
    webUrl: z.string().nullable(),
    links: z.array(documentLinkSchema),
  })
  .meta({ id: "ExternalDocumentDetail" });
export type ExternalDocumentDetail = z.infer<typeof documentDetailSchema>;

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  /** Searches the title and text live in the caller's account; without it the synced documents are listed. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Only documents with this tag (a provider tag id). */
  tag: z.coerce.number().int().positive().optional(),
  /** Only documents of this correspondent (a provider id). */
  correspondent: z.coerce.number().int().positive().optional(),
  /** `true`: only documents linked somewhere; `false`: only unlinked ones. */
  linked: queryBooleanSchema.optional(),
});
export const listDocumentsResponseSchema = paginated(externalDocumentSchema);

export const SUGGESTION_KINDS = ["asset", "contact"] as const;

export const assetSuggestionSchema = z
  .object({
    kind: z.literal("asset"),
    provider: documentProviderSchema,
    externalId: z.number().int(),
    title: z.string(),
    createdDate: dateSchema.nullable(),
    correspondentName: z.string().nullable(),
    warrantyUntil: dateSchema.nullable(),
    warrantyExtendedUntil: dateSchema.nullable(),
  })
  .meta({ id: "AssetSuggestion" });

export const contactSuggestionSchema = z
  .object({
    kind: z.literal("contact"),
    provider: documentProviderSchema,
    correspondentId: z.number().int(),
    name: z.string(),
    /** Synced documents of this correspondent. */
    documentCount: z.number().int(),
    /** Pass these two as `externalSource` / `externalRef` when creating the contact from the suggestion. */
    externalSource: z.string(),
    externalRef: z.string(),
  })
  .meta({ id: "ContactSuggestion" });

export const documentSuggestionSchema = z.discriminatedUnion("kind", [
  assetSuggestionSchema,
  contactSuggestionSchema,
]);

export const documentSuggestionsQuerySchema = z.object({
  kind: z.enum(SUGGESTION_KINDS),
});
export const documentSuggestionsResponseSchema = z.object({
  items: z.array(documentSuggestionSchema),
});

export const downloadQuerySchema = z.object({
  /** `1` asks for the original file instead of the archived PDF. */
  original: z
    .enum(["0", "1", "true", "false"])
    .transform((value) => value === "1" || value === "true")
    .optional(),
});

export const listDocumentLinksQuerySchema = paginationQuerySchema.extend({
  ownerType: documentLinkOwnerTypeSchema.optional(),
  ownerId: idSchema.optional(),
  provider: documentProviderSchema.optional(),
  externalId: externalDocumentIdSchema.optional(),
});
export const listDocumentLinksResponseSchema = paginated(documentLinkSchema);

export const createDocumentLinkRequestSchema = z.strictObject({
  provider: documentProviderSchema.default(DOCUMENT_PROVIDERS[0]),
  externalId: externalDocumentIdSchema,
  ownerType: documentLinkOwnerTypeSchema,
  ownerId: idSchema,
  role: documentLinkRoleSchema.default("other"),
  label: nullableText(200).optional(),
});
export type CreateDocumentLinkRequest = z.output<
  typeof createDocumentLinkRequestSchema
>;

export const pushToDocumentsRequestSchema = z.strictObject({
  provider: documentProviderSchema.default(DOCUMENT_PROVIDERS[0]),
  /** The document's title; defaults to the file name without extension. */
  title: z.string().trim().min(1).max(128).optional(),
  /** What the document is for on the owner of the attachment. */
  role: documentLinkRoleSchema.default("other"),
  label: nullableText(200).optional(),
});
export type PushToDocumentsRequest = z.output<
  typeof pushToDocumentsRequestSchema
>;

export const documentUploadSchema = z
  .object({
    id: z.string(),
    provider: documentProviderSchema,
    status: z.enum(DOCUMENT_UPLOAD_STATUSES),
    attachmentId: z.string(),
    ownerType: documentLinkOwnerTypeSchema,
    ownerId: z.string(),
    role: documentLinkRoleSchema,
    title: z.string(),
    /** The document, once it exists. */
    externalId: z.number().int().nullable(),
    /** The link to the owner, once it was made. */
    linkId: z.string().nullable(),
    /** The provider already held this file: the existing document was linked. */
    duplicate: z.boolean(),
    /** Short machine-readable code of the failure (`timeout`, `unauthorized`, `duplicate`, ...). */
    errorCode: z.string().nullable(),
    /** The document exists but giving the group access failed: `permissions_failed`. */
    warning: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "DocumentUpload" });
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

export const documentUploadParamsSchema = z.object({ jobId: idSchema });

/** Narrows a provider's lists (tags, correspondents, ...) to names containing the text. */
export const listPickerQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
});

const pickerResponse = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item) });

export const externalTagSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    color: z.string().nullable(),
    documentCount: z.number().int().nullable(),
  })
  .meta({ id: "ExternalTag" });
export const listTagsResponseSchema = pickerResponse(externalTagSchema);

export const externalCorrespondentSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    documentCount: z.number().int().nullable(),
  })
  .meta({ id: "ExternalCorrespondent" });
export const listCorrespondentsResponseSchema = pickerResponse(
  externalCorrespondentSchema,
);

export const externalCustomFieldSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    /** `date`, `string`, `monetary`, ...; the warranty fields must be dates. */
    dataType: z.string(),
  })
  .meta({ id: "ExternalCustomField" });
export const listCustomFieldsResponseSchema = pickerResponse(
  externalCustomFieldSchema,
);

export const externalGroupSchema = z
  .object({ id: z.number().int(), name: z.string() })
  .meta({ id: "ExternalGroup" });
export const listGroupsResponseSchema = pickerResponse(externalGroupSchema);

export const externalStoragePathSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    path: z.string().nullable(),
  })
  .meta({ id: "ExternalStoragePath" });
export const listStoragePathsResponseSchema = pickerResponse(
  externalStoragePathSchema,
);
