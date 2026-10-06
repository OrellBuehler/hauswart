import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { HintKind } from "$lib/api/enums";
import {
  assetHints,
  assets,
  attachments,
  contacts,
  docPages,
  rooms,
} from "$lib/server/db";
import type { AttachmentRecord } from "$lib/server/attachments/attachments";
import { attachmentsById } from "$lib/server/attachments/attachments";
import {
  fillGuestToken,
  guestAttachmentUrl,
  guestPageUrl,
  referencedAttachmentIds,
} from "$lib/server/docs/render";
import { MarkdownError } from "$lib/server/docs/markdown-core";
import { renderMarkdownAsync } from "$lib/server/docs/markdown";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { slugify } from "$lib/server/slug";
import { sectionsOf, type GuestLinkRow } from "./guest-links";

type Db = Pick<ServiceContext, "db">;
type PageRow = typeof docPages.$inferSelect;

const PAGE_SECTIONS = ["emergency", "rules", "howto"] as const;

export interface GuestContact {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
}

export interface GuestFile {
  id: string;
  filename: string;
  caption: string | null;
  mime: string;
}

export interface GuestHint {
  id: string;
  title: string;
  kind: HintKind;
  html: string;
  files: GuestFile[];
}

export interface GuestDevice {
  id: string;
  name: string;
  roomName: string | null;
  hints: GuestHint[];
}

export interface GuestPageLink {
  slug: string;
  title: string;
}

export interface GuestHome {
  householdName: string;
  emergencyContacts: GuestContact[];
  contacts: GuestContact[];
  devices: GuestDevice[];
  pages: {
    emergency: GuestPageLink[];
    rules: GuestPageLink[];
    howto: GuestPageLink[];
    other: GuestPageLink[];
  };
}

export interface GuestPageView {
  title: string;
  html: string;
}

/**
 * Pages are shared by their own flag AND the link: a page must be guest visible and either
 * chosen by id or in one of the link's page sections (emergency, rules, howto).
 */
export function pageAccessible(link: GuestLinkRow, page: PageRow): boolean {
  if (page.archivedAt || !page.guestVisible) return false;
  const { sections, pageIds } = sectionsOf(link);
  if (pageIds.includes(page.id)) return true;
  return (
    (PAGE_SECTIONS as readonly string[]).includes(page.section) &&
    (sections as readonly string[]).includes(page.section)
  );
}

const RENDER_CACHE_MAX = 300;
const RENDER_CACHE_TTL_MS = 60_000;
const renderCache = new Map<string, { html: string; at: number }>();

/** Rendered guest HTML (token placeholder not filled yet); cached because anyone with the link can ask. */
async function renderGuestHtml(
  ctx: Db,
  key: string,
  md: string,
  includeSecrets: boolean,
): Promise<string> {
  const cached = renderCache.get(key);
  if (cached && Date.now() - cached.at < RENDER_CACHE_TTL_MS) {
    return cached.html;
  }
  const known = attachmentsById(ctx, referencedAttachmentIds(md));
  let html: string;
  try {
    html = await renderMarkdownAsync(md, {
      audience: "guest",
      includeSecrets,
      resolveAttachmentUrl: (id) =>
        known.get(id)?.guestVisible ? guestAttachmentUrl(id) : null,
      resolvePageUrl: (slug) => guestPageUrl(slugify(slug)),
    });
  } catch (err) {
    if (!(err instanceof MarkdownError)) throw err;
    console.error(
      JSON.stringify({ event: "guest.render_failed", code: err.code }),
    );
    return "";
  }
  if (!renderCache.has(key) && renderCache.size >= RENDER_CACHE_MAX) {
    renderCache.delete(renderCache.keys().next().value as string);
  }
  renderCache.set(key, { html, at: Date.now() });
  return html;
}

export function clearGuestRenderCache(): void {
  renderCache.clear();
}

function guestContact(c: typeof contacts.$inferSelect): GuestContact {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    phone: c.phone,
    email: c.email,
  };
}

function sharedPages(ctx: Db, link: GuestLinkRow): PageRow[] {
  return ctx.db
    .select()
    .from(docPages)
    .where(and(isNull(docPages.archivedAt), eq(docPages.guestVisible, true)))
    .orderBy(
      desc(docPages.pinned),
      asc(docPages.sortOrder),
      asc(docPages.title),
      asc(docPages.id),
    )
    .all()
    .filter((page) => pageAccessible(link, page));
}

function guestFiles(ctx: Db, hintIds: string[]): Map<string, GuestFile[]> {
  const byHint = new Map<string, GuestFile[]>();
  if (hintIds.length === 0) return byHint;
  const rows = ctx.db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "asset_hint"),
        inArray(attachments.ownerId, hintIds),
        eq(attachments.guestVisible, true),
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
  for (const row of rows) {
    byHint.set(row.ownerId, [
      ...(byHint.get(row.ownerId) ?? []),
      {
        id: row.id,
        filename: row.filename,
        caption: row.caption,
        mime: row.mime,
      },
    ]);
  }
  return byHint;
}

async function devicesOf(
  ctx: Db,
  link: GuestLinkRow,
  token: string,
): Promise<GuestDevice[]> {
  const hints = ctx.db
    .select()
    .from(assetHints)
    .where(eq(assetHints.guestVisible, true))
    .orderBy(
      desc(assetHints.pinned),
      asc(assetHints.sortOrder),
      asc(assetHints.createdAt),
      asc(assetHints.id),
    )
    .all();
  const hinted = new Set(hints.map((h) => h.assetId));
  const rows = ctx.db
    .select({ asset: assets, roomName: rooms.name })
    .from(assets)
    .leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(isNull(assets.archivedAt))
    .orderBy(asc(assets.name), asc(assets.id))
    .all()
    .filter(({ asset }) => asset.showOnEmergency || hinted.has(asset.id));
  const shown = new Set(rows.map((r) => r.asset.id));
  const visible = hints.filter((h) => shown.has(h.assetId));
  const files = guestFiles(
    ctx,
    visible.map((h) => h.id),
  );
  const html = new Map<string, string>();
  for (const hint of visible) {
    html.set(
      hint.id,
      fillGuestToken(
        await renderGuestHtml(
          ctx,
          `hint:${hint.id}:${hint.updatedAt.getTime()}:${link.includeSecrets}`,
          hint.bodyMd,
          link.includeSecrets,
        ),
        token,
      ),
    );
  }
  return rows.map(({ asset, roomName }) => ({
    id: asset.id,
    name: asset.name,
    roomName,
    hints: visible
      .filter((h) => h.assetId === asset.id)
      .map((h) => ({
        id: h.id,
        title: h.title,
        kind: h.kind,
        html: html.get(h.id) ?? "",
        files: files.get(h.id) ?? [],
      })),
  }));
}

/** Everything the guest start page shows for a link; nothing the flags and the link do not allow. */
export async function getGuestHome(
  ctx: Db,
  link: GuestLinkRow,
  token: string,
): Promise<GuestHome> {
  const { sections } = sectionsOf(link);
  const wants = (name: (typeof sections)[number]) => sections.includes(name);

  const shared = ctx.db
    .select()
    .from(contacts)
    .where(eq(contacts.guestVisible, true))
    .orderBy(asc(contacts.sortOrder), asc(contacts.name), asc(contacts.id))
    .all();
  const emergencyContacts = wants("emergency")
    ? shared.filter((c) => c.emergency).map(guestContact)
    : [];
  const listed = new Set(emergencyContacts.map((c) => c.id));
  const others = wants("contacts")
    ? shared.filter((c) => !listed.has(c.id)).map(guestContact)
    : [];

  const pages: GuestHome["pages"] = {
    emergency: [],
    rules: [],
    howto: [],
    other: [],
  };
  for (const page of sharedPages(ctx, link)) {
    const group = (PAGE_SECTIONS as readonly string[]).includes(page.section)
      ? (page.section as (typeof PAGE_SECTIONS)[number])
      : "other";
    pages[group].push({ slug: page.slug, title: page.title });
  }

  return {
    householdName: getHousehold(ctx).name,
    emergencyContacts,
    contacts: others,
    devices: wants("devices") ? await devicesOf(ctx, link, token) : [],
    pages,
  };
}

export async function getGuestPage(
  ctx: Db,
  link: GuestLinkRow,
  token: string,
  slug: string,
): Promise<GuestPageView | null> {
  const page = ctx.db
    .select()
    .from(docPages)
    .where(eq(docPages.slug, slug))
    .get();
  if (!page || !pageAccessible(link, page)) return null;
  const html = link.includeSecrets
    ? await renderGuestHtml(
        ctx,
        `page:${page.id}:${page.rev}:true`,
        page.bodyMd,
        true,
      )
    : page.renderedHtmlGuest;
  return { title: page.title, html: fillGuestToken(html, token) };
}

/**
 * An attachment a guest may download: guest visible itself AND owned by something the link
 * shares (a page it shows, or a guest-visible hint of a device it lists). Anything else is
 * null, whether it exists or not.
 */
export function getGuestFile(
  ctx: Db,
  link: GuestLinkRow,
  id: string,
): AttachmentRecord | null {
  const attachment = ctx.db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .get();
  if (!attachment || !attachment.guestVisible) return null;
  if (attachment.ownerType === "page") {
    const page = ctx.db
      .select()
      .from(docPages)
      .where(eq(docPages.id, attachment.ownerId))
      .get();
    return page && pageAccessible(link, page) ? attachment : null;
  }
  if (attachment.ownerType === "asset_hint") {
    if (!sectionsOf(link).sections.includes("devices")) return null;
    const hint = ctx.db
      .select({
        guestVisible: assetHints.guestVisible,
        archivedAt: assets.archivedAt,
      })
      .from(assetHints)
      .innerJoin(assets, eq(assets.id, assetHints.assetId))
      .where(eq(assetHints.id, attachment.ownerId))
      .get();
    return hint && hint.guestVisible && !hint.archivedAt ? attachment : null;
  }
  return null;
}
