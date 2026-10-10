import { z } from "zod";
import { ASSET_NOTE_STATUSES, ASSET_NOTE_STATUS_FILTERS } from "../enums";
import {
  atLeastOne,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
} from "./common";
import { defectSchema } from "./defects";

export const ASSET_NOTE_MAX_LENGTH = 2000;

export const assetNoteStatusSchema = z.enum(ASSET_NOTE_STATUSES);

/** A small issue to mention at the next appointment ("brakes squeak"). */
export const assetNoteSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    assetName: z.string(),
    body: z.string(),
    status: assetNoteStatusSchema,
    resolvedAt: isoTimestampSchema.nullable(),
    /** Who resolved it; null while open, or when the person no longer exists. */
    resolvedBy: z.string().nullable(),
    resolvedByName: z.string().nullable(),
    /** The service log entry that addressed the issue; null while open, when resolved by hand or when the entry was deleted. */
    serviceLogId: z.string().nullable(),
    /** The defect the note was turned into; null until then, or when that defect was deleted. */
    defectId: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "AssetNote" });
export type AssetNote = z.infer<typeof assetNoteSchema>;

/** Newest first. `status` defaults to the open notes; `all` lists both. */
export const listAssetNotesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ASSET_NOTE_STATUS_FILTERS).default("open"),
});
export const listAssetNotesResponseSchema = paginated(assetNoteSchema);

const body = z.string().trim().min(1).max(ASSET_NOTE_MAX_LENGTH);

export const createAssetNoteRequestSchema = z.strictObject({ body });
export type CreateAssetNoteRequest = z.output<
  typeof createAssetNoteRequestSchema
>;

/**
 * `status: "resolved"` records who resolved it and when; `"open"` reopens it (and forgets the
 * service log entry that addressed it).
 */
export const updateAssetNoteRequestSchema = atLeastOne(
  z.strictObject({
    body: body.optional(),
    status: assetNoteStatusSchema.optional(),
  }),
);
export type UpdateAssetNoteRequest = z.output<
  typeof updateAssetNoteRequestSchema
>;

export const assetNoteToDefectResponseSchema = z.object({
  note: assetNoteSchema,
  defect: defectSchema,
});
