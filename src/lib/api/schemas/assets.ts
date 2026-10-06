import { z } from "zod";
import { ASSET_KINDS } from "../enums";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
  slugSchema,
} from "./common";

export const assetKindSchema = z.enum(ASSET_KINDS);

export const QR_SLUG_LENGTH = 10;
export const qrSlugSchema = z.string().regex(/^[a-z2-7]{10}$/, {
  error: "Not a valid QR slug.",
});

export const assetSchema = z
  .object({
    id: z.string(),
    kind: assetKindSchema,
    name: z.string(),
    slug: z.string(),
    qrSlug: z.string(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    category: z.string().nullable(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    serialNumber: z.string().nullable(),
    purchaseDate: dateSchema.nullable(),
    installedDate: dateSchema.nullable(),
    warrantyUntil: dateSchema.nullable(),
    warrantyExtendedUntil: dateSchema.nullable(),
    showOnEmergency: z.boolean(),
    notes: z.string().nullable(),
    species: z.string().nullable(),
    light: z.string().nullable(),
    waterNotes: z.string().nullable(),
    photoAttachmentId: z.string().nullable(),
    /** The thumbnail (480 px WebP) of the photo, usable as `<img src>`; null without a photo. */
    photoUrl: z.string().nullable(),
    /** Opaque link to the same thing in another system (set by adapters); the pair is unique. */
    externalSource: z.string().nullable(),
    externalRef: z.string().nullable(),
    archivedAt: isoTimestampSchema.nullable(),
    commentCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Asset" });
export type Asset = z.infer<typeof assetSchema>;

export const listAssetsQuerySchema = paginationQuerySchema.extend({
  kind: assetKindSchema.optional(),
  roomId: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  includeArchived: queryBooleanSchema.optional(),
});
export const listAssetsResponseSchema = paginated(assetSchema);

export const assetByQrParamsSchema = z.object({ qrSlug: qrSlugSchema });

const assetFields = {
  kind: assetKindSchema,
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  roomId: idSchema.nullable(),
  category: nullableText(64),
  manufacturer: nullableText(120),
  model: nullableText(120),
  serialNumber: nullableText(120),
  purchaseDate: dateSchema.nullable(),
  installedDate: dateSchema.nullable(),
  warrantyUntil: dateSchema.nullable(),
  warrantyExtendedUntil: dateSchema.nullable(),
  showOnEmergency: z.boolean(),
  notes: nullableText(50_000),
  species: nullableText(120),
  light: nullableText(120),
  waterNotes: nullableText(2000),
  photoAttachmentId: idSchema.nullable(),
  externalSource: z.string().trim().min(1).max(64).nullable(),
  externalRef: z.string().trim().min(1).max(255).nullable(),
};

/** `kind` defaults to `device`; `slug` is derived from the name when omitted. */
export const createAssetRequestSchema = z.strictObject({
  kind: assetFields.kind.default("device"),
  name: assetFields.name,
  slug: assetFields.slug.optional(),
  roomId: assetFields.roomId.optional(),
  category: assetFields.category.optional(),
  manufacturer: assetFields.manufacturer.optional(),
  model: assetFields.model.optional(),
  serialNumber: assetFields.serialNumber.optional(),
  purchaseDate: assetFields.purchaseDate.optional(),
  installedDate: assetFields.installedDate.optional(),
  warrantyUntil: assetFields.warrantyUntil.optional(),
  warrantyExtendedUntil: assetFields.warrantyExtendedUntil.optional(),
  showOnEmergency: assetFields.showOnEmergency.default(false),
  notes: assetFields.notes.optional(),
  species: assetFields.species.optional(),
  light: assetFields.light.optional(),
  waterNotes: assetFields.waterNotes.optional(),
  photoAttachmentId: assetFields.photoAttachmentId.optional(),
  externalSource: assetFields.externalSource.optional(),
  externalRef: assetFields.externalRef.optional(),
});
export type CreateAssetRequest = z.output<typeof createAssetRequestSchema>;

export const updateAssetRequestSchema = atLeastOne(
  z.strictObject({
    kind: assetFields.kind.optional(),
    name: assetFields.name.optional(),
    slug: assetFields.slug.optional(),
    roomId: assetFields.roomId.optional(),
    category: assetFields.category.optional(),
    manufacturer: assetFields.manufacturer.optional(),
    model: assetFields.model.optional(),
    serialNumber: assetFields.serialNumber.optional(),
    purchaseDate: assetFields.purchaseDate.optional(),
    installedDate: assetFields.installedDate.optional(),
    warrantyUntil: assetFields.warrantyUntil.optional(),
    warrantyExtendedUntil: assetFields.warrantyExtendedUntil.optional(),
    showOnEmergency: assetFields.showOnEmergency.optional(),
    notes: assetFields.notes.optional(),
    species: assetFields.species.optional(),
    light: assetFields.light.optional(),
    waterNotes: assetFields.waterNotes.optional(),
    photoAttachmentId: assetFields.photoAttachmentId.optional(),
    externalSource: assetFields.externalSource.optional(),
    externalRef: assetFields.externalRef.optional(),
    archived: z.boolean().optional(),
  }),
);
export type UpdateAssetRequest = z.output<typeof updateAssetRequestSchema>;
