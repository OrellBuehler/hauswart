import { z } from "zod";
import { DOC_SECTIONS } from "../../../src/lib/api/enums";
import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import type {
  DocPage,
  DocPageSummary,
} from "../../../src/lib/api/schemas/docs";
import {
  SEARCH_HIT_TYPES,
  type searchHitSchema,
} from "../../../src/lib/api/schemas/search";
import { ToolError } from "../errors";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { attachmentRows } from "./attachments";

const slug = z
  .string()
  .min(1)
  .max(200)
  .describe("Page slug, from list_pages or search (the part after /docs/)");
const limit = z.number().int().min(1).max(100).default(30);
const cursor = z.string().min(1).max(512).optional();
const ref = (what: string) => z.string().min(1).max(120).describe(what);

const pageRow = (p: DocPageSummary) => ({
  slug: p.slug,
  title: p.title,
  section: p.section,
  pinned: p.pinned ? true : null,
  guestVisible: p.guestVisible ? true : null,
  archived: p.archivedAt ? true : null,
  rev: p.rev,
  excerpt: p.excerpt,
  updatedBy: p.updatedByName,
  updated: p.updatedAt.slice(0, 10),
});

const pageDetail = (p: DocPage) => ({
  id: p.id,
  ...pageRow(p),
  assetId: p.assetId,
  roomId: p.roomId,
  bodyMd: p.bodyMd,
  headings: p.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`),
  backlinks: p.backlinks.map((b) => ({ slug: b.slug, title: b.title })),
  commentCount: p.commentCount || null,
});

export const search = defineTool({
  name: "search",
  title: "Search everything",
  description:
    "Full-text search across documentation pages, assets, rooms, tasks, defects, contacts, spare parts and care hints, best match first. Every word matches as a prefix; case and accents are ignored. type restricts the kind of result. Each hit has its kind, id, a snippet and the app path; read a page with get_page (its slug is in the hit), defects, contacts and assets with their get_* tool. Archived documents that are already linked to something are found by title (type document, from the token user's own document system; its documentId is in the hit, the url is the first thing it is linked to): read one with get_document, and look for unlinked ones with search_documents. Phone numbers, e-mail and addresses of contacts and secret blocks of pages are never searched.",
  mode: "read",
  input: {
    q: z.string().trim().min(1).max(100).describe("Words to look for"),
    type: z.enum(SEARCH_HIT_TYPES).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async handler(args, ctx) {
    const { items } = await ctx.api.call(endpoints.search, { query: args });
    const row = (hit: z.infer<typeof searchHitSchema>) => ({
      type: hit.type,
      id: hit.id,
      title: hit.title,
      snippet: hit.snippet,
      slug: hit.type === "page" ? hit.url.replace(/^\/docs\//, "") : null,
      documentId: hit.type === "document" ? Number(hit.id.split(":")[1]) : null,
      url: hit.url,
    });
    return {
      summary: `${plural(items.length, "hit")} for "${args.q}".`,
      data: { hits: items.map(row) },
    };
  },
});

export const listPages = defineTool({
  name: "list_pages",
  title: "List documentation pages",
  description:
    "The household's documentation pages (manuals, how-tos, rules, emergency information), pinned first. Filter by section (general, device, room, emergency, rules, howto), asset or room (id or name) the page belongs to, pinned, or q (full-text search, best match first). Archived pages are hidden unless includeArchived. Returns slug, title, rev and a short excerpt; read a page with get_page.",
  mode: "read",
  input: {
    q: z.string().trim().min(1).max(100).optional(),
    section: z.enum(DOC_SECTIONS).optional(),
    asset: ref("Asset id or name").optional(),
    room: ref("Room id, slug or name").optional(),
    pinned: z.boolean().optional(),
    includeArchived: z.boolean().default(false),
    limit,
    cursor,
  },
  async handler(args, ctx) {
    const [asset, room] = await Promise.all([
      args.asset ? ctx.resolveAsset(args.asset) : undefined,
      args.room ? ctx.resolveRoom(args.room) : undefined,
    ]);
    const page = await ctx.api.call(endpoints.pagesList, {
      query: {
        q: args.q,
        section: args.section,
        assetId: asset?.id,
        roomId: room?.id,
        pinned:
          args.pinned === undefined
            ? undefined
            : args.pinned
              ? "true"
              : "false",
        includeArchived: args.includeArchived ? "true" : undefined,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "page")}.${moreHint(page.nextCursor)}`,
      data: { pages: page.items.map(pageRow), nextCursor: page.nextCursor },
    };
  },
});

export const getPage = defineTool({
  name: "get_page",
  title: "Read a documentation page",
  description:
    "One page with its markdown source, `rev` (pass it to update_page), headings, backlinks and attached files (names only). The markdown is what members see: it includes secret blocks (`:::secret ... :::`), which only the guest link hides, so do not repeat them where they do not belong. `[[slug]]` links to another page, `attachment:<id>` embeds an attached file.",
  mode: "read",
  input: { slug },
  async handler({ slug }, ctx) {
    const page = await ctx.api.call(endpoints.pagesGet, { params: { slug } });
    const attachments = await attachmentRows(ctx, "page", page.id);
    return {
      summary: `${page.title} (rev ${page.rev}, ${page.section}).`,
      data: { ...pageDetail(page), attachments },
    };
  },
});

const pageFields = {
  section: z.enum(DOC_SECTIONS),
  asset: ref("Asset id or name the page is about"),
  room: ref("Room id, slug or name the page is about"),
  bodyMd: z
    .string()
    .max(200_000)
    .describe(
      "Markdown. [[slug]] links to a page, attachment:<id> to an attached file, :::secret blocks are hidden from guests",
    ),
  pinned: z.boolean(),
  guestVisible: z.boolean().describe("Shown on the guest link"),
};

export const createPage = defineTool({
  name: "create_page",
  title: "Create a documentation page",
  description:
    "Adds a documentation page. title is required; the slug (its address) is derived from it. section defaults to general. bodyMd is markdown: [[slug]] links to another page, :::secret ... ::: marks text that guests never see (Wi-Fi passwords, door codes). guestVisible shows the page on the guest link (secret blocks stay hidden). Needs the docs:write scope.",
  mode: "create",
  scopes: ["docs:write"],
  input: {
    title: z.string().trim().min(1).max(200),
    bodyMd: pageFields.bodyMd.optional(),
    section: pageFields.section.optional(),
    asset: pageFields.asset.optional(),
    room: pageFields.room.optional(),
    pinned: pageFields.pinned.optional(),
    guestVisible: pageFields.guestVisible.optional(),
  },
  async handler({ asset: assetRef, room: roomRef, ...rest }, ctx) {
    const [asset, room] = await Promise.all([
      assetRef ? ctx.resolveAsset(assetRef) : undefined,
      roomRef ? ctx.resolveRoom(roomRef) : undefined,
    ]);
    const page = await ctx.api.call(endpoints.pagesCreate, {
      body: { ...rest, assetId: asset?.id, roomId: room?.id },
    });
    return {
      summary: `Created page "${page.title}" at /docs/${page.slug} (rev ${page.rev}).`,
      data: pageDetail(page),
    };
  },
});

export const updatePage = defineTool({
  name: "update_page",
  title: "Update a documentation page",
  description:
    "Changes a page; only the fields you pass change (title, bodyMd as the complete new text, section, asset, room, pinned, guestVisible, archived). rev must be the `rev` you got from get_page: if someone saved in the meantime nothing is overwritten and the call fails with a conflict naming the current rev, so read the page again and redo the change. Every save keeps the previous text as a revision. null clears asset or room. Needs the docs:write scope.",
  mode: "update",
  scopes: ["docs:write"],
  input: {
    slug,
    rev: z
      .number()
      .int()
      .min(1)
      .describe("The rev of the page you read, from get_page"),
    title: z.string().trim().min(1).max(200).optional(),
    bodyMd: pageFields.bodyMd.optional(),
    section: pageFields.section.optional(),
    asset: pageFields.asset.nullable().optional(),
    room: pageFields.room.nullable().optional(),
    pinned: pageFields.pinned.optional(),
    guestVisible: pageFields.guestVisible.optional(),
    archived: z.boolean().optional(),
  },
  async handler({ slug, rev, asset: assetRef, room: roomRef, ...rest }, ctx) {
    const [asset, room] = await Promise.all([
      assetRef ? ctx.resolveAsset(assetRef) : undefined,
      roomRef ? ctx.resolveRoom(roomRef) : undefined,
    ]);
    const body = {
      ...rest,
      assetId: assetRef === null ? null : asset?.id,
      roomId: roomRef === null ? null : room?.id,
    };
    const changed = Object.entries(body)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (changed.length === 0) {
      throw new ToolError(
        "invalid_request",
        "Pass at least one field to change.",
      );
    }
    try {
      const page = await ctx.api.call(endpoints.pagesUpdate, {
        params: { slug },
        body: { rev, ...body },
      });
      return {
        summary: `Updated "${page.title}" (${changed.join(", ")}); now rev ${page.rev}.`,
        data: pageDetail(page),
      };
    } catch (err) {
      const current = isApiError(err)
        ? (err.details as { currentRev?: number } | undefined)?.currentRev
        : undefined;
      if (isApiError(err) && err.code === "conflict" && current !== undefined) {
        throw new ToolError(
          "conflict",
          `The page was changed since rev ${rev}; it is now rev ${current}. Read it again with get_page and redo the change.`,
        );
      }
      throw err;
    }
  },
});

export const docTools = [search, listPages, getPage, createPage, updatePage];
