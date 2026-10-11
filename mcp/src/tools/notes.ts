import { z } from "zod";
import { ASSET_NOTE_STATUS_FILTERS } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { AssetNote } from "../../../src/lib/api/schemas/asset-notes";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";

const noteRow = (n: AssetNote) => ({
  id: n.id,
  asset: n.assetName,
  text: n.body,
  status: n.status,
  addedBy: n.createdByName,
  addedAt: n.createdAt,
  resolvedBy: n.resolvedByName,
  resolvedAt: n.resolvedAt,
  serviceLogId: n.serviceLogId,
  defectId: n.defectId,
});

const noteId = z
  .string()
  .min(1)
  .max(64)
  .describe("Note id, from list_asset_notes");

export const addAssetNote = defineTool({
  name: "add_asset_note",
  title: "Note an issue on an asset",
  description:
    "Writes down a small issue to mention at the next service appointment, such as 'brakes squeak' or 'dishwasher leaves film on glasses'. asset is the id or name of the device, plant or vehicle; text is the issue in a sentence or two (at most 2000 characters). The note stays open until a service log entry addresses it or somebody resolves it. For a problem that needs a deadline or a claim report a defect instead.",
  mode: "create",
  input: {
    asset: z
      .string()
      .min(1)
      .max(120)
      .describe("Asset id, name or (vehicles) plate"),
    text: z.string().trim().min(1).max(2000),
  },
  async handler({ asset: assetRef, text }, ctx) {
    const asset = await ctx.resolveAsset(assetRef);
    const note = await ctx.api.call(endpoints.assetNotesCreate, {
      params: { id: asset.id },
      body: { body: text },
    });
    return {
      summary: `Noted on ${asset.name}: ${note.body.split("\n")[0]}`,
      data: noteRow(note),
    };
  },
});

export const listAssetNotes = defineTool({
  name: "list_asset_notes",
  title: "List the notes of an asset",
  description:
    "The issues noted on one asset to mention at its next appointment, newest first. status: open (default), resolved or all. A resolved note says who resolved it and, if a service log entry addressed it or it became a defect, which. The open count of the asset of a task shows as openNotes in list_tasks, get_task and list_upcoming.",
  mode: "read",
  input: {
    asset: z
      .string()
      .min(1)
      .max(120)
      .describe("Asset id, name or (vehicles) plate"),
    status: z.enum(ASSET_NOTE_STATUS_FILTERS).default("open"),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const asset = await ctx.resolveAsset(args.asset);
    const page = await ctx.api.call(endpoints.assetNotesList, {
      params: { id: asset.id },
      query: { status: args.status, cursor: args.cursor, limit: args.limit },
    });
    return {
      summary: `${plural(page.items.length, args.status === "all" ? "note" : `${args.status} note`)} on ${asset.name}.${moreHint(page.nextCursor)}`,
      data: { notes: page.items.map(noteRow), nextCursor: page.nextCursor },
    };
  },
});

export const resolveAssetNote = defineTool({
  name: "resolve_asset_note",
  title: "Resolve a note",
  description:
    "Marks a note as resolved, as the token's user, once the issue was dealt with or is no longer a concern. Resolving a resolved note changes nothing. To record the work that fixed it, log it with add_service_log or complete the service task in the app, which resolve the notes they name.",
  mode: "update",
  input: { id: noteId },
  async handler({ id }, ctx) {
    const note = await ctx.api.call(endpoints.assetNotesUpdate, {
      params: { id },
      body: { status: "resolved" },
    });
    return {
      summary: `Resolved on ${note.assetName}: ${note.body.split("\n")[0]}`,
      data: noteRow(note),
    };
  },
});

export const noteTools = [addAssetNote, listAssetNotes, resolveAssetNote];
