import { z } from "zod";
import { ASSET_KINDS } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Asset } from "../../../src/lib/api/schemas/assets";
import { ToolError } from "../errors";
import { assetRow, moreHint, plural, taskRow } from "../format";
import { defineTool } from "../tool";

const date = z.iso.date();
const assetRef = z
  .string()
  .min(1)
  .max(120)
  .describe("Asset id or name, from list_assets");

const fields = {
  kind: z
    .enum(ASSET_KINDS)
    .describe("device, plant, fixture, vehicle or other"),
  room: z.string().min(1).max(100).describe("Room id, slug or name"),
  category: z.string().max(64).describe("Free text, e.g. a type of appliance"),
  manufacturer: z.string().max(120),
  model: z.string().max(120),
  serialNumber: z.string().max(120),
  purchaseDate: date,
  installedDate: date,
  warrantyUntil: date,
  warrantyExtendedUntil: date,
  notes: z.string().max(50_000).describe("Markdown notes"),
  species: z.string().max(120).describe("Plants: species"),
  light: z.string().max(120).describe("Plants: light needs"),
  waterNotes: z.string().max(2000).describe("Plants: watering notes"),
  showOnEmergency: z.boolean().describe("Show on the emergency page"),
};

/** The same fields for a patch: each may be omitted, and cleared with null (not kind and showOnEmergency). */
const clearable = <K extends keyof typeof fields>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, fields[k].nullable().optional()])) as {
    [P in K]: z.ZodOptional<z.ZodNullable<(typeof fields)[P]>>;
  };

const detail = (a: Asset) => ({
  ...assetRow(a),
  slug: a.slug,
  serialNumber: a.serialNumber,
  purchaseDate: a.purchaseDate,
  installedDate: a.installedDate,
  showOnEmergency: a.showOnEmergency ? true : null,
  notes: a.notes,
  species: a.species,
  light: a.light,
  waterNotes: a.waterNotes,
});

export const listRooms = defineTool({
  name: "list_rooms",
  title: "List rooms",
  description:
    "All rooms of the household, in display order, with ids. Room names can be used wherever a tool takes a room.",
  mode: "read",
  input: {},
  async handler(_args, ctx) {
    const rooms = [];
    let cursor: string | undefined;
    do {
      const page = await ctx.api.call(endpoints.roomsList, {
        query: { cursor, limit: 200 },
      });
      rooms.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return {
      summary: plural(rooms.length, "room") + ".",
      data: {
        rooms: rooms.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          notes: r.notes,
        })),
      },
    };
  },
});

export const listAssets = defineTool({
  name: "list_assets",
  title: "List assets",
  description:
    "Devices, plants, fixtures, vehicles and other things in the household. Filter by kind, room (id, slug or name) and q (text in name, model, manufacturer). Archived assets are hidden unless includeArchived.",
  mode: "read",
  input: {
    kind: fields.kind.optional(),
    room: fields.room.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const room = args.room ? await ctx.resolveRoom(args.room) : undefined;
    const page = await ctx.api.call(endpoints.assetsList, {
      query: {
        kind: args.kind,
        roomId: room?.id,
        q: args.q,
        includeArchived: args.includeArchived ? "true" : undefined,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "asset")}.${moreHint(page.nextCursor)}`,
      data: { assets: page.items.map(assetRow), nextCursor: page.nextCursor },
    };
  },
});

export const getAsset = defineTool({
  name: "get_asset",
  title: "Get an asset",
  description:
    "One asset in full (model, serial number, purchase and warranty dates, notes) together with its tasks and their due state.",
  mode: "read",
  input: { asset: assetRef },
  async handler({ asset: ref }, ctx) {
    const asset = await ctx.resolveAsset(ref);
    const [tasks, users] = await Promise.all([
      ctx.api.call(endpoints.tasksList, {
        query: { assetId: asset.id, limit: 100 },
      }),
      ctx.users(),
    ]);
    return {
      summary: `${asset.name}${asset.roomName ? ` (${asset.roomName})` : ""}: ${plural(tasks.items.length, "task")}.`,
      data: {
        ...detail(asset),
        tasks: tasks.items.map((t) => taskRow(t, users)),
        tasksTruncated: tasks.nextCursor ? true : null,
      },
    };
  },
});

export const createAsset = defineTool({
  name: "create_asset",
  title: "Create an asset",
  description:
    "Adds a device, plant, fixture, vehicle or other thing. Only name is required; kind defaults to device. A vehicle's plate and registration data are entered in the app; record its odometer with record_odometer. Dates are YYYY-MM-DD. Add tasks for it with create_task (asset = its name or id).",
  mode: "create",
  input: {
    name: z.string().trim().min(1).max(120),
    kind: fields.kind.optional(),
    room: fields.room.optional(),
    category: fields.category.optional(),
    manufacturer: fields.manufacturer.optional(),
    model: fields.model.optional(),
    serialNumber: fields.serialNumber.optional(),
    purchaseDate: fields.purchaseDate.optional(),
    installedDate: fields.installedDate.optional(),
    warrantyUntil: fields.warrantyUntil.optional(),
    warrantyExtendedUntil: fields.warrantyExtendedUntil.optional(),
    notes: fields.notes.optional(),
    species: fields.species.optional(),
    light: fields.light.optional(),
    waterNotes: fields.waterNotes.optional(),
    showOnEmergency: fields.showOnEmergency.optional(),
  },
  async handler({ room: roomRef, ...rest }, ctx) {
    const room = roomRef ? await ctx.resolveRoom(roomRef) : undefined;
    const asset = await ctx.api.call(endpoints.assetsCreate, {
      body: { ...rest, roomId: room?.id },
    });
    return {
      summary: `Created ${asset.kind} "${asset.name}"${asset.roomName ? ` in ${asset.roomName}` : ""}.`,
      data: detail(asset),
    };
  },
});

export const updateAsset = defineTool({
  name: "update_asset",
  title: "Update an asset",
  description:
    "Changes fields of an asset; only the fields you pass change, and null clears one (room, category, manufacturer, model, serialNumber, dates, notes, plant fields). archived: true archives the asset (hides it, keeps its history), false restores it.",
  mode: "update",
  input: {
    asset: assetRef,
    name: z.string().trim().min(1).max(120).optional(),
    kind: fields.kind.optional(),
    ...clearable(
      "room",
      "category",
      "manufacturer",
      "model",
      "serialNumber",
      "purchaseDate",
      "installedDate",
      "warrantyUntil",
      "warrantyExtendedUntil",
      "notes",
      "species",
      "light",
      "waterNotes",
    ),
    showOnEmergency: fields.showOnEmergency.optional(),
    archived: z.boolean().optional(),
  },
  async handler({ asset: ref, room: roomRef, ...rest }, ctx) {
    const current = await ctx.resolveAsset(ref);
    const room = roomRef ? await ctx.resolveRoom(roomRef) : undefined;
    const body = { ...rest, roomId: roomRef === null ? null : room?.id };
    const changed = Object.entries(body).filter(([, v]) => v !== undefined);
    if (changed.length === 0) {
      throw new ToolError(
        "invalid_request",
        "Pass at least one field to change.",
      );
    }
    const asset = await ctx.api.call(endpoints.assetsUpdate, {
      params: { id: current.id },
      body,
    });
    return {
      summary: `Updated "${asset.name}" (${changed.map(([k]) => k).join(", ")}).`,
      data: detail(asset),
    };
  },
});

export const assetTools = [
  listRooms,
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
];
