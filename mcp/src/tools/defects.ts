import { z } from "zod";
import { DEFECT_SEVERITIES, DEFECT_STATUSES } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type {
  Defect,
  DefectTimelineItem,
} from "../../../src/lib/api/schemas/defects";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { attachmentRows } from "./attachments";
import { resolveContact } from "./resolve";

const date = z.iso.date();
const defectId = z
  .string()
  .min(1)
  .max(64)
  .describe("Defect id, from list_defects");

const defectRow = (d: Defect) => ({
  id: d.id,
  number: d.number,
  title: d.title,
  status: d.status,
  severity: d.severity,
  room: d.roomName,
  asset: d.assetName,
  location: d.locationDetail,
  discoveredOn: d.discoveredOn,
  reportedOn: d.reportedOn,
  fixedOn: d.fixedOn,
  deadline: d.deadlineDate,
  responsible: d.responsibleContactName,
  comments: d.commentCount || null,
});

const timelineRow = (item: DefectTimelineItem) =>
  item.kind === "event"
    ? {
        at: item.at,
        by: item.userName,
        type: item.type,
        from: item.fromStatus,
        to: item.toStatus,
        text: item.bodyMd,
        reference: item.externalRef,
      }
    : {
        at: item.at,
        by: item.userName,
        type: "comment",
        text: item.deleted ? null : item.bodyMd,
        edited: item.editedAt ? true : null,
        deleted: item.deleted ? true : null,
      };

export const listDefects = defineTool({
  name: "list_defects",
  title: "List defects",
  description:
    "Defects (Mängel) of the apartment with a running number, status, severity and deadline. status: `active` (default; open, reported and in progress, by deadline), `all`, or one of open|reported|in_progress|fixed|rejected. Optional filters: severity, room and asset (id or name), q (text in title and description). Use before reporting a new defect to avoid duplicates; read one with get_defect.",
  mode: "read",
  input: {
    status: z.enum(["active", "all", ...DEFECT_STATUSES]).default("active"),
    severity: z.enum(DEFECT_SEVERITIES).optional(),
    room: z.string().min(1).max(100).optional(),
    asset: z.string().min(1).max(120).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const [room, asset] = await Promise.all([
      args.room ? ctx.resolveRoom(args.room) : undefined,
      args.asset ? ctx.resolveAsset(args.asset) : undefined,
    ]);
    const page = await ctx.api.call(endpoints.defectsList, {
      query: {
        active: args.status === "active" ? "true" : undefined,
        status:
          args.status === "active" || args.status === "all"
            ? undefined
            : args.status,
        severity: args.severity,
        roomId: room?.id,
        assetId: asset?.id,
        q: args.q,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "defect")}.${moreHint(page.nextCursor)}`,
      data: { defects: page.items.map(defectRow), nextCursor: page.nextCursor },
    };
  },
});

export const getDefect = defineTool({
  name: "get_defect",
  title: "Get a defect",
  description:
    "One defect in full (description, location, dates, deadline, responsible contact, resolution) with its timeline: status changes, notes on correspondence and comments, oldest first, and the names of attached photos and documents.",
  mode: "read",
  input: { id: defectId },
  async handler({ id }, ctx) {
    const [defect, timeline, attachments] = await Promise.all([
      ctx.api.call(endpoints.defectsGet, { params: { id } }),
      ctx.api.call(endpoints.defectsTimeline, { params: { id } }),
      attachmentRows(ctx, "defect", id),
    ]);
    return {
      summary: `#${defect.number} ${defect.title}: ${defect.status}${defect.deadlineDate ? `, deadline ${defect.deadlineDate}` : ""}.`,
      data: {
        ...defectRow(defect),
        description: defect.descriptionMd,
        resolution: defect.resolutionMd,
        timeline: timeline.items.map(timelineRow),
        attachments,
      },
    };
  },
});

export const createDefect = defineTool({
  name: "create_defect",
  title: "Report a defect",
  description:
    "Records a defect. Only title is required; severity defaults to medium, discoveredOn to today. Without deadlineDate the deadline is the handover date plus the household's defect period (when a handover date is set); deadlineDate: null means none. A deadline creates a reminder task. room, asset and responsibleContact can be given by name. Check list_defects first for duplicates.",
  mode: "create",
  input: {
    title: z.string().trim().min(1).max(200),
    descriptionMd: z.string().max(50_000).optional(),
    severity: z.enum(DEFECT_SEVERITIES).optional(),
    room: z.string().min(1).max(100).optional(),
    asset: z.string().min(1).max(120).optional(),
    locationDetail: z
      .string()
      .max(500)
      .optional()
      .describe("Where exactly, e.g. 'left of the window'"),
    discoveredOn: date.optional(),
    reportedOn: date.optional().describe("When it was reported to the owner"),
    responsibleContact: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe("Contact id or name, from list_contacts"),
    deadlineDate: date.nullable().optional(),
  },
  async handler({ room, asset, responsibleContact, ...rest }, ctx) {
    const [r, a, c] = await Promise.all([
      room ? ctx.resolveRoom(room) : undefined,
      asset ? ctx.resolveAsset(asset) : undefined,
      responsibleContact ? resolveContact(ctx, responsibleContact) : undefined,
    ]);
    const defect = await ctx.api.call(endpoints.defectsCreate, {
      body: {
        ...rest,
        roomId: r?.id,
        assetId: a?.id,
        responsibleContactId: c?.id,
      },
    });
    return {
      summary: `Reported defect #${defect.number} "${defect.title}"${defect.deadlineDate ? `, deadline ${defect.deadlineDate}` : ""}.`,
      data: defectRow(defect),
    };
  },
});

export const setDefectStatus = defineTool({
  name: "set_defect_status",
  title: "Change the status of a defect",
  description:
    "Moves a defect to open, reported, in_progress, fixed or rejected and writes the change to its timeline (note explains it). Open, reported and in progress can go to any other status; fixed and rejected can only be reopened. reported sets reportedOn and fixed sets fixedOn to today unless given.",
  mode: "update",
  input: {
    id: defectId,
    status: z.enum(DEFECT_STATUSES),
    note: z.string().trim().max(10_000).optional(),
    reportedOn: date.optional(),
    fixedOn: date.optional(),
  },
  async handler({ id, ...body }, ctx) {
    const defect = await ctx.api.call(endpoints.defectsStatus, {
      params: { id },
      body,
    });
    return {
      summary: `Defect #${defect.number} "${defect.title}" is now ${defect.status}.`,
      data: defectRow(defect),
    };
  },
});

export const defectTools = [
  listDefects,
  getDefect,
  createDefect,
  setDefectStatus,
];
