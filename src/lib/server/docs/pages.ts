import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { ApiError } from "$lib/api/errors";
import type {
  CreatePageRequest,
  UpdatePageRequest,
} from "$lib/api/schemas/docs";
import { RESERVED_PAGE_SLUGS } from "$lib/api/schemas/docs";
import type { DocSection } from "$lib/api/enums";
import {
  getDB,
  assets,
  docPageRevisions,
  docPages,
  rooms,
  users,
} from "$lib/server/db";
import {
  onAttachmentsChanged,
  removeOwnedAttachments,
  trackBackground,
} from "$lib/server/attachments/attachments";
import { paginateArray } from "$lib/server/pagination";
import { searchRefs } from "$lib/server/search/search";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { slugify, uniqueSlug } from "$lib/server/slug";
import {
  referencedAttachmentIds,
  renderPageContent,
  wikiLinkSlugs,
  type RenderedPage,
} from "./render";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

/** Saved states kept per page. */
export const MAX_REVISIONS = 50;
const EXCERPT_LENGTH = 160;

export type PageRow = typeof docPages.$inferSelect;
export interface PageRecord extends PageRow {
  updatedByName: string | null;
}
export interface Backlink {
  id: string;
  slug: string;
  title: string;
}
export interface PageDetail extends PageRecord {
  backlinks: Backlink[];
}

const userName = sql<
  string | null
>`coalesce(${users.displayName}, ${users.username})`;

const selectPages = (db: Db["db"]) =>
  db
    .select({ page: docPages, updatedByName: userName })
    .from(docPages)
    .leftJoin(users, eq(docPages.updatedBy, users.id));

const toRecord = (row: {
  page: PageRow;
  updatedByName: string | null;
}): PageRecord => ({ ...row.page, updatedByName: row.updatedByName });

export const excerptOf = (page: Pick<PageRow, "plainText">): string =>
  page.plainText.slice(0, EXCERPT_LENGTH);

export interface PageFilter {
  section?: DocSection;
  assetId?: string;
  roomId?: string;
  q?: string;
  pinned?: boolean;
  includeArchived?: boolean;
}

export function listPages(
  ctx: Db,
  filter: PageFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (!filter.includeArchived) where.push(sql`${docPages.archivedAt} is null`);
  if (filter.section) where.push(eq(docPages.section, filter.section));
  if (filter.assetId) where.push(eq(docPages.assetId, filter.assetId));
  if (filter.roomId) where.push(eq(docPages.roomId, filter.roomId));
  if (filter.pinned !== undefined) {
    where.push(eq(docPages.pinned, filter.pinned));
  }
  let ranking: Map<string, number> | null = null;
  if (filter.q) {
    const ids = searchRefs(ctx, "page", filter.q);
    ranking = new Map(ids.map((id, index) => [id, index]));
    where.push(inArray(docPages.id, ids));
  }
  const rows = selectPages(ctx.db)
    .where(and(...where))
    .orderBy(
      desc(docPages.pinned),
      asc(docPages.sortOrder),
      asc(sql`lower(${docPages.title})`),
      asc(docPages.id),
    )
    .all()
    .map(toRecord);
  if (ranking) {
    const rank = ranking;
    rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }
  return paginateArray(rows, page.cursor, page.limit);
}

export function findPage(ctx: Db, slug: string): PageRecord | undefined {
  const row = selectPages(ctx.db).where(eq(docPages.slug, slug)).get();
  return row && toRecord(row);
}

export function getPage(ctx: Db, slug: string): PageRecord {
  const page = findPage(ctx, slug);
  if (!page) throw notFound("Page");
  return page;
}

/** Pages (not archived) that link to this one with `[[slug]]`; computed from the sources on read. */
export function backlinksOf(ctx: Db, page: Pick<PageRow, "id" | "slug">) {
  const candidates = ctx.db
    .select({
      id: docPages.id,
      slug: docPages.slug,
      title: docPages.title,
      bodyMd: docPages.bodyMd,
    })
    .from(docPages)
    .where(
      and(
        sql`${docPages.archivedAt} is null`,
        ne(docPages.id, page.id),
        like(docPages.bodyMd, "%[[%"),
      ),
    )
    .orderBy(asc(sql`lower(${docPages.title})`), asc(docPages.id))
    .all();
  return candidates
    .filter((c) => wikiLinkSlugs(c.bodyMd).includes(page.slug))
    .map(({ id, slug, title }): Backlink => ({ id, slug, title }));
}

export function getPageDetail(ctx: Db, slug: string): PageDetail {
  const page = getPage(ctx, slug);
  return { ...page, backlinks: backlinksOf(ctx, page) };
}

function assertLinks(
  ctx: Db,
  links: { assetId?: string | null; roomId?: string | null },
): void {
  if (links.assetId) {
    const asset = ctx.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, links.assetId))
      .get();
    if (!asset) throw invalidField("assetId", "Asset does not exist");
  }
  if (links.roomId) {
    const room = ctx.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.id, links.roomId))
      .get();
    if (!room) throw invalidField("roomId", "Room does not exist");
  }
}

const slugTaken = (ctx: Db, slug: string) =>
  (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug) ||
  ctx.db
    .select({ id: docPages.id })
    .from(docPages)
    .where(eq(docPages.slug, slug))
    .get() !== undefined;

const slugConflict = () => conflict("A page with this slug already exists");

function cacheFields(rendered: RenderedPage) {
  return {
    renderedHtmlMember: rendered.memberHtml,
    renderedHtmlGuest: rendered.guestHtml,
    plainText: rendered.plainText,
    headingsJson: rendered.headings,
  };
}

export async function createPage(
  ctx: Now,
  input: CreatePageRequest,
  userId: string,
): Promise<PageDetail> {
  assertLinks(ctx, input);
  const slug =
    input.slug ??
    uniqueSlug(slugify(input.title), (candidate) => slugTaken(ctx, candidate));
  if (input.slug && slugTaken(ctx, slug)) throw slugConflict();
  const rendered = await renderPageContent(ctx, input.bodyMd);
  try {
    const id = ctx.db.transaction((tx) => {
      const row = tx
        .insert(docPages)
        .values({
          slug,
          title: input.title,
          section: input.section,
          assetId: input.assetId ?? null,
          roomId: input.roomId ?? null,
          bodyMd: input.bodyMd,
          ...cacheFields(rendered),
          sortOrder: input.sortOrder ?? 0,
          guestVisible: input.guestVisible,
          pinned: input.pinned,
          rev: 1,
          updatedBy: userId,
        })
        .returning({ id: docPages.id })
        .get();
      tx.insert(docPageRevisions)
        .values({
          pageId: row.id,
          rev: 1,
          title: input.title,
          bodyMd: input.bodyMd,
          userId,
        })
        .run();
      return row.id;
    });
    const created = selectPages(ctx.db).where(eq(docPages.id, id)).get()!;
    return { ...toRecord(created), backlinks: backlinksOf(ctx, created.page) };
  } catch (err) {
    if (isUniqueViolation(err)) throw slugConflict();
    throw err;
  }
}

function revConflict(currentRev: number): ApiError {
  return new ApiError("conflict", "The page was changed in the meantime", {
    details: { currentRev },
  });
}

export async function updatePage(
  ctx: Now,
  slug: string,
  patch: UpdatePageRequest,
  userId: string,
): Promise<PageDetail> {
  const current = getPage(ctx, slug);
  if (patch.rev !== current.rev) throw revConflict(current.rev);
  assertLinks(ctx, patch);
  if (
    patch.slug !== undefined &&
    patch.slug !== current.slug &&
    slugTaken(ctx, patch.slug)
  ) {
    throw slugConflict();
  }
  const rendered =
    patch.bodyMd !== undefined && patch.bodyMd !== current.bodyMd
      ? await renderPageContent(ctx, patch.bodyMd)
      : null;

  const fields = {
    title: patch.title,
    slug: patch.slug,
    section: patch.section,
    assetId: patch.assetId,
    roomId: patch.roomId,
    bodyMd: patch.bodyMd,
    sortOrder: patch.sortOrder,
    guestVisible: patch.guestVisible,
    pinned: patch.pinned,
  };
  const archived = patch.archived;
  const nextRev = current.rev + 1;
  let saved: PageRow | undefined;
  try {
    saved = ctx.db.transaction((tx) => {
      // The guard on `rev` makes the check above binding: of two concurrent saves one finds
      // no row to update.
      const row = tx
        .update(docPages)
        .set({
          ...fields,
          ...(rendered ? cacheFields(rendered) : {}),
          ...(archived === undefined
            ? {}
            : {
                archivedAt: archived
                  ? (current.archivedAt ?? new Date(ctx.now))
                  : null,
              }),
          rev: nextRev,
          updatedBy: userId,
        })
        .where(and(eq(docPages.id, current.id), eq(docPages.rev, current.rev)))
        .returning()
        .get();
      if (!row) return undefined;
      tx.insert(docPageRevisions)
        .values({
          pageId: row.id,
          rev: row.rev,
          title: row.title,
          bodyMd: row.bodyMd,
          userId,
        })
        .run();
      tx.delete(docPageRevisions)
        .where(
          and(
            eq(docPageRevisions.pageId, row.id),
            lte(docPageRevisions.rev, row.rev - MAX_REVISIONS),
          ),
        )
        .run();
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugConflict();
    throw err;
  }
  if (!saved) {
    const latest = findPage(ctx, slug);
    if (!latest) throw notFound("Page");
    throw revConflict(latest.rev);
  }
  return getPageDetail(ctx, saved.slug);
}

/** Removes the page with its revisions and attachments. */
export function deletePage(ctx: Now, slug: string): void {
  const page = getPage(ctx, slug);
  ctx.db.delete(docPages).where(eq(docPages.id, page.id)).run();
  removeOwnedAttachments(ctx, "page", page.id);
}

export interface RevisionSummary {
  rev: number;
  title: string;
  size: number;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
}
export interface RevisionRecord extends RevisionSummary {
  bodyMd: string;
}

const revisionColumns = {
  rev: docPageRevisions.rev,
  title: docPageRevisions.title,
  size: sql<number>`length(cast(${docPageRevisions.bodyMd} as blob))`,
  userId: docPageRevisions.userId,
  userName: userName,
  createdAt: docPageRevisions.createdAt,
};

export function listRevisions(ctx: Db, slug: string): RevisionSummary[] {
  const page = getPage(ctx, slug);
  return ctx.db
    .select(revisionColumns)
    .from(docPageRevisions)
    .leftJoin(users, eq(docPageRevisions.userId, users.id))
    .where(eq(docPageRevisions.pageId, page.id))
    .orderBy(desc(docPageRevisions.rev))
    .all();
}

export function getRevision(
  ctx: Db,
  slug: string,
  rev: number,
): RevisionRecord {
  const page = getPage(ctx, slug);
  const row = ctx.db
    .select({ ...revisionColumns, bodyMd: docPageRevisions.bodyMd })
    .from(docPageRevisions)
    .leftJoin(users, eq(docPageRevisions.userId, users.id))
    .where(
      and(eq(docPageRevisions.pageId, page.id), eq(docPageRevisions.rev, rev)),
    )
    .get();
  if (!row) throw notFound("Revision");
  return row;
}

/** Saves an earlier revision's title and markdown as a new revision. */
export async function restoreRevision(
  ctx: Now,
  slug: string,
  rev: number,
  userId: string,
): Promise<PageDetail> {
  const revision = getRevision(ctx, slug, rev);
  const current = getPage(ctx, slug);
  return updatePage(
    ctx,
    slug,
    { rev: current.rev, title: revision.title, bodyMd: revision.bodyMd },
    userId,
  );
}

/**
 * Renders the cached HTML of the pages that embed one of the attachments again (they were
 * deleted or their guest visibility changed). Only the two HTML columns change, and only when
 * the page was not saved in the meantime.
 */
export async function rerenderPagesUsing(
  ctx: Db,
  attachmentIds: readonly string[],
): Promise<number> {
  const seen = new Map<string, PageRow>();
  for (const id of attachmentIds) {
    const pages = ctx.db
      .select()
      .from(docPages)
      .where(like(docPages.bodyMd, `%attachment:${id}%`))
      .all();
    for (const page of pages) {
      if (referencedAttachmentIds(page.bodyMd).includes(id)) {
        seen.set(page.id, page);
      }
    }
  }
  let updated = 0;
  for (const page of seen.values()) {
    const rendered = await renderPageContent(ctx, page.bodyMd);
    const result = ctx.db
      .update(docPages)
      .set({
        renderedHtmlMember: rendered.memberHtml,
        renderedHtmlGuest: rendered.guestHtml,
        updatedAt: page.updatedAt,
      })
      .where(and(eq(docPages.id, page.id), eq(docPages.rev, page.rev)))
      .returning({ id: docPages.id })
      .all();
    updated += result.length;
  }
  return updated;
}

/**
 * Keeps cached page HTML in step with attachments: call once from the startup hook. Returns a
 * function that stops it.
 */
export function startAttachmentRerender(): () => void {
  return onAttachmentsChanged((ids) => {
    trackBackground(
      rerenderPagesUsing({ db: getDB() }, ids),
      "docs.rerender_failed",
    );
  });
}
