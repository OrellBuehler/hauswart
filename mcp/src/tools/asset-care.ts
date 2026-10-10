import { z } from "zod";
import {
  HINT_KINDS,
  SERVICE_LOG_KINDS,
  WARRANTY_STATUSES,
} from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Hint } from "../../../src/lib/api/schemas/hints";
import type { Warranty } from "../../../src/lib/api/schemas/warranties";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { resolveContact } from "./resolve";

const date = z.iso.date();

const hintRow = (h: Hint) => ({
  id: h.id,
  asset: h.assetName,
  assetId: h.assetId,
  kind: h.kind,
  title: h.title,
  text: h.bodyMd,
  pinned: h.pinned ? true : null,
  task: h.taskTitle,
  comments: h.commentCount || null,
});

const warrantyRow = (w: Warranty) => ({
  assetId: w.assetId,
  asset: w.assetName,
  room: w.roomName,
  manufacturer: w.manufacturer,
  model: w.model,
  purchaseDate: w.purchaseDate,
  warrantyUntil: w.warrantyUntil,
  extendedUntil: w.warrantyExtendedUntil,
  effectiveUntil: w.effectiveUntil,
  status: w.status,
  daysLeft: w.daysLeft,
});

export const listHints = defineTool({
  name: "list_hints",
  title: "List care hints",
  description:
    "Care hints attached to assets: tips, rules and warnings such as 'run the dishwasher hot once a month' or 'never use bleach on the worktop'. Filter by asset (id or name) and kind (tip, rule, warning). Pinned hints come first. Read these before advising on how to use or care for a device.",
  mode: "read",
  input: {
    asset: z.string().min(1).max(120).optional(),
    kind: z.enum(HINT_KINDS).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const asset = args.asset ? await ctx.resolveAsset(args.asset) : undefined;
    const page = await ctx.api.call(endpoints.hintsList, {
      query: {
        assetId: asset?.id,
        kind: args.kind,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "hint")}${asset ? ` for ${asset.name}` : ""}.${moreHint(page.nextCursor)}`,
      data: { hints: page.items.map(hintRow), nextCursor: page.nextCursor },
    };
  },
});

export const addServiceLog = defineTool({
  name: "add_service_log",
  title: "Log service work on an asset",
  description:
    "Adds an entry to an asset's service log: maintenance, repair, installation, inspection, replacement or other. title is required; date defaults to today. contact (id or name from list_contacts) is who did it, performedBy a free-text name, costMinor the cost in minor units of the household currency (cents/Rappen; 12900 = 129.00). resolvedNoteIds are notes of this asset (ids from list_asset_notes) that the work addressed: they become resolved. For work done as part of a recurring task prefer complete_task, which can log it too.",
  mode: "create",
  input: {
    asset: z.string().min(1).max(120).describe("Asset id or name"),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(SERVICE_LOG_KINDS).default("maintenance"),
    date: date.optional(),
    descriptionMd: z.string().max(50_000).optional(),
    contact: z.string().min(1).max(160).optional(),
    performedBy: z.string().trim().min(1).max(160).optional(),
    costMinor: z.number().int().min(0).optional(),
    resolvedNoteIds: z
      .array(z.string().min(1).max(64))
      .max(50)
      .optional()
      .describe("Ids of the asset's open notes this work addressed"),
  },
  async handler({ asset: assetRef, contact: contactRef, ...rest }, ctx) {
    const [asset, contact] = await Promise.all([
      ctx.resolveAsset(assetRef),
      contactRef ? resolveContact(ctx, contactRef) : undefined,
    ]);
    const entry = await ctx.api.call(endpoints.assetServiceLogCreate, {
      params: { id: asset.id },
      body: { ...rest, contactId: contact?.id },
    });
    return {
      summary: `Logged ${entry.kind} "${entry.title}" on ${entry.assetName} (${entry.date}).`,
      data: {
        id: entry.id,
        asset: entry.assetName,
        date: entry.date,
        kind: entry.kind,
        title: entry.title,
        contact: entry.contactName,
        performedBy: entry.performedBy,
        costMinor: entry.costMinor,
        currency: entry.currency,
      },
    };
  },
});

export const listWarranties = defineTool({
  name: "list_warranties",
  title: "List warranties",
  description:
    "Warranty status of the household's assets, soonest to expire first: valid, expiring (within 90 days) or expired, with the last day of cover and the days left. The later of warranty and extended warranty counts. Filter by status. Use it before paying for a repair of something that may still be covered.",
  mode: "read",
  input: {
    status: z.enum(WARRANTY_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.warrantiesList, { query: args });
    return {
      summary: `${plural(page.items.length, "warranty", "warranties")}.${moreHint(page.nextCursor)}`,
      data: {
        warranties: page.items.map(warrantyRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const assetCareTools = [listHints, addServiceLog, listWarranties];
