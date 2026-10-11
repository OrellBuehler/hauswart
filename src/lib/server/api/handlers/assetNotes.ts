import type { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type { assetNoteSchema } from "$lib/api/schemas/asset-notes";
import type { endpoints } from "$lib/api/registry";
import {
  createNote,
  deleteNote,
  listNotes,
  noteToDefect,
  updateNote,
  type AssetNoteRecord,
} from "$lib/server/asset-notes/notes";
import type { Handler } from "../bind";
import { wireDefect } from "../wire";

export function wireAssetNote(
  n: AssetNoteRecord,
): z.input<typeof assetNoteSchema> {
  return {
    id: n.id,
    assetId: n.assetId,
    assetName: n.assetName,
    body: n.body,
    status: n.status,
    resolvedAt: n.resolvedAt ? toIso(n.resolvedAt) : null,
    resolvedBy: n.resolvedBy,
    resolvedByName: n.resolvedByName,
    serviceLogId: n.serviceLogId,
    defectId: n.defectId,
    createdBy: n.createdBy,
    createdByName: n.createdByName,
    createdAt: toIso(n.createdAt),
    updatedAt: toIso(n.updatedAt),
  };
}

export const list: Handler<typeof endpoints.assetNotesList> = ({
  ctx,
  params,
  query,
}) => {
  const { cursor, limit, status } = query;
  const page = listNotes(ctx, params.id, { status }, { cursor, limit });
  return { items: page.items.map(wireAssetNote), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.assetNotesCreate> = ({
  ctx,
  params,
  body,
}) => wireAssetNote(createNote(ctx, params.id, body, ctx.user.id));

export const update: Handler<typeof endpoints.assetNotesUpdate> = ({
  ctx,
  params,
  body,
}) => wireAssetNote(updateNote(ctx, params.id, body, ctx.user.id));

export const remove: Handler<typeof endpoints.assetNotesDelete> = ({
  ctx,
  params,
}) => {
  deleteNote(ctx, params.id);
  return null;
};

export const toDefect: Handler<typeof endpoints.assetNotesToDefect> = ({
  ctx,
  params,
}) => {
  const { note, defect } = noteToDefect(ctx, params.id, ctx.user.id);
  return { note: wireAssetNote(note), defect: wireDefect(defect) };
};
