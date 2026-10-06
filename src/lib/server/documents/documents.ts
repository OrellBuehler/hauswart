import { and, eq, sql } from "drizzle-orm";
import { DOCUMENT_PROVIDERS, type DocumentProviderKind } from "$lib/api/enums";
import { externalDocuments } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import { notFound, type ServiceContext } from "$lib/server/service";
import { markInvisible, toMeta, upsertDocuments } from "./cache";
import {
  linkSummaries,
  linksOfDocument,
  linkViews,
  type LinkSummary,
  type LinkView,
} from "./links";
import type {
  DocumentFileKind,
  DocumentFileStream,
  ExternalDocumentMeta,
} from "./provider";
import { documentSession, ownConnectionRow, viaProvider } from "./session";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export interface DocumentView {
  provider: DocumentProviderKind;
  meta: ExternalDocumentMeta;
  linkedTo: LinkSummary[];
}

export interface DocumentFilter {
  q?: string;
  tag?: number;
  correspondent?: number;
  linked?: boolean;
}

/** The most hits one live search returns (one page of the provider's list). */
export const MAX_SEARCH_HITS = 100;

const byDateThenTitle = (a: ExternalDocumentMeta, b: ExternalDocumentMeta) =>
  (b.createdDate ?? "").localeCompare(a.createdDate ?? "") ||
  a.title.localeCompare(b.title, "de") ||
  a.externalId - b.externalId;

function withLinks(
  ctx: Db,
  provider: DocumentProviderKind,
  metas: readonly ExternalDocumentMeta[],
): DocumentView[] {
  const links = linkSummaries(
    ctx,
    provider,
    metas.map((m) => m.externalId),
  );
  return metas.map((meta) => ({
    provider,
    meta,
    linkedTo: links.get(meta.externalId) ?? [],
  }));
}

/**
 * The documents the caller's own account sees. With `q` the provider is asked live (title and
 * text); without it the synced documents are listed from the cache. 404 when the caller has no
 * connection to any provider.
 */
export async function listDocuments(
  ctx: Db,
  userId: string,
  filter: DocumentFilter,
  page: { cursor?: string; limit: number },
) {
  const kinds = DOCUMENT_PROVIDERS.filter((kind) =>
    ownConnectionRow(ctx, kind, userId),
  );
  if (kinds.length === 0) throw notFound("Connection");

  const views: DocumentView[] = [];
  for (const kind of kinds) {
    if (filter.q) {
      const session = documentSession(ctx, kind, userId);
      const hits = await viaProvider(() =>
        session.provider.search(session.connection, {
          q: filter.q as string,
          tagId: filter.tag,
          correspondentId: filter.correspondent,
          limit: MAX_SEARCH_HITS,
        }),
      );
      views.push(...withLinks(ctx, kind, hits));
    } else {
      const row = ownConnectionRow(ctx, kind, userId);
      if (!row) continue;
      const rows = ctx.db
        .select()
        .from(externalDocuments)
        .where(
          and(
            eq(externalDocuments.connectionId, row.id),
            eq(externalDocuments.ownerVisible, true),
            filter.tag !== undefined
              ? sql`exists (select 1 from json_each(${externalDocuments.tagIds}) where value = ${filter.tag})`
              : undefined,
            filter.correspondent !== undefined
              ? eq(externalDocuments.correspondentId, filter.correspondent)
              : undefined,
          ),
        )
        .all();
      views.push(...withLinks(ctx, kind, rows.map(toMeta)));
    }
  }
  const visible = views
    .filter(
      (v) =>
        filter.linked === undefined || v.linkedTo.length > 0 === filter.linked,
    )
    .sort((a, b) => byDateThenTitle(a.meta, b.meta));
  return paginateArray(visible, page.cursor, page.limit);
}

export interface DocumentDetail {
  view: DocumentView;
  links: LinkView[];
  webUrl: string | null;
}

/**
 * One document, asked live through the caller's own connection: a document the account cannot
 * see is a 404 (and is remembered as not visible), whatever other people's accounts may see.
 */
export async function getDocumentDetail(
  ctx: Now,
  userId: string,
  provider: DocumentProviderKind,
  externalId: number,
): Promise<DocumentDetail> {
  const session = documentSession(ctx, provider, userId);
  const meta = await viaProvider(() =>
    session.provider.get(session.connection, externalId),
  );
  if (!meta) {
    markInvisible(ctx, session.row.id, provider, [externalId]);
    throw notFound("Document");
  }
  upsertDocuments(ctx, session.row.id, provider, [meta]);
  const [view] = withLinks(ctx, provider, [meta]);
  return {
    view,
    links: linkViews(ctx, userId, linksOfDocument(ctx, provider, externalId)),
    webUrl: session.provider.webUrl(session.connection, externalId),
  };
}

/** Opens the file of a document through the caller's own connection (404 without one or without access). */
export async function openDocumentFile(
  ctx: Db,
  userId: string,
  provider: DocumentProviderKind,
  externalId: number,
  kind: DocumentFileKind,
  options: { original?: boolean } = {},
): Promise<DocumentFileStream> {
  const session = documentSession(ctx, provider, userId);
  return viaProvider(() =>
    session.provider.openFile(session.connection, externalId, kind, options),
  );
}
