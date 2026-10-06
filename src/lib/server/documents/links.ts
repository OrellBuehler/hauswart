import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import type {
  DocumentLinkOwnerType,
  DocumentLinkRole,
  DocumentProviderKind,
} from "$lib/api/enums";
import type { CreateDocumentLinkRequest } from "$lib/api/schemas/documents";
import { trackBackground } from "$lib/server/attachments/attachments";
import { connections, documentLinks } from "$lib/server/db";
import { emitEvent } from "$lib/server/events";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import {
  cachedByIds,
  markInvisible,
  upsertDocuments,
  type CachedDocument,
} from "./cache";
import { linkNoteText } from "./notes";
import { ownerInfo, type OwnerInfo } from "./owners";
import {
  documentSession,
  ownConnectionRow,
  viaProvider,
  type DocumentSession,
} from "./session";
import { applyDocumentWarranties, WARRANTY_ROLES } from "./warranty";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type LinkRow = typeof documentLinks.$inferSelect;

/** A link as one person sees it: the owner, and what their own account knows of the document. */
export interface LinkView {
  link: LinkRow;
  owner: OwnerInfo | null;
  /** Whether the person's own connection can read the document. */
  available: boolean;
  /** Present exactly when `available`. */
  document: CachedDocument | null;
}

export interface LinkSummary {
  linkId: string;
  ownerType: DocumentLinkOwnerType;
  ownerId: string;
  ownerTitle: string | null;
  role: DocumentLinkRole;
}

export function findLink(ctx: Db, id: string): LinkRow | undefined {
  return ctx.db
    .select()
    .from(documentLinks)
    .where(eq(documentLinks.id, id))
    .get();
}

/** The link that already holds this document, owner and role. */
export function findLinkByKey(
  ctx: Db,
  key: {
    provider: DocumentProviderKind;
    externalId: number;
    ownerType: DocumentLinkOwnerType;
    ownerId: string;
    role: DocumentLinkRole;
  },
): LinkRow | undefined {
  return ctx.db
    .select()
    .from(documentLinks)
    .where(
      and(
        eq(documentLinks.provider, key.provider),
        eq(documentLinks.externalId, key.externalId),
        eq(documentLinks.ownerType, key.ownerType),
        eq(documentLinks.ownerId, key.ownerId),
        eq(documentLinks.role, key.role),
      ),
    )
    .get();
}

export function getLink(ctx: Db, id: string): LinkRow {
  const row = findLink(ctx, id);
  if (!row) throw notFound("Document link");
  return row;
}

/**
 * Turns link rows into what `userId` may see. Documents are read through each person's own
 * connection, so a link made with somebody else's account shows its document only when the
 * viewer's account can read it too (and points at the same instance); otherwise it is "not
 * shared": no title, no previews.
 */
export function linkViews(
  ctx: Db,
  userId: string,
  rows: readonly LinkRow[],
): LinkView[] {
  const providers = [...new Set(rows.map((r) => r.provider))];
  const own = new Map<
    DocumentProviderKind,
    {
      id: string;
      baseUrl: string;
      cached: Map<number, CachedDocument>;
    }
  >();
  for (const provider of providers) {
    const row = ownConnectionRow(ctx, provider, userId);
    if (!row) continue;
    const ids = rows
      .filter((r) => r.provider === provider)
      .map((r) => r.externalId);
    own.set(provider, {
      id: row.id,
      baseUrl: row.baseUrl,
      cached: cachedByIds(ctx, row.id, ids),
    });
  }
  const linkConnectionIds = [
    ...new Set(rows.map((r) => r.connectionId).filter((v) => v !== null)),
  ];
  const baseUrls = new Map<string, string>();
  if (linkConnectionIds.length > 0) {
    for (const c of ctx.db
      .select({ id: connections.id, baseUrl: connections.baseUrl })
      .from(connections)
      .where(inArray(connections.id, linkConnectionIds))
      .all()) {
      baseUrls.set(c.id, c.baseUrl);
    }
  }
  return rows.map((link) => {
    const mine = own.get(link.provider);
    const madeAt = link.connectionId
      ? baseUrls.get(link.connectionId)
      : undefined;
    const sameInstance = madeAt === undefined || madeAt === mine?.baseUrl;
    const doc = sameInstance ? mine?.cached.get(link.externalId) : undefined;
    const available = doc?.ownerVisible === true;
    return {
      link,
      owner: ownerInfo(ctx.db, link.ownerType, link.ownerId),
      available,
      document: available ? (doc ?? null) : null,
    };
  });
}

export interface LinkFilter {
  ownerType?: DocumentLinkOwnerType;
  ownerId?: string;
  provider?: DocumentProviderKind;
  externalId?: number;
}

export function listLinks(
  ctx: Db,
  userId: string,
  filter: LinkFilter,
  page: { cursor?: string; limit: number },
) {
  const where: (SQL | undefined)[] = [
    filter.ownerType
      ? eq(documentLinks.ownerType, filter.ownerType)
      : undefined,
    filter.ownerId ? eq(documentLinks.ownerId, filter.ownerId) : undefined,
    filter.provider ? eq(documentLinks.provider, filter.provider) : undefined,
    filter.externalId !== undefined
      ? eq(documentLinks.externalId, filter.externalId)
      : undefined,
  ];
  const rows = ctx.db
    .select()
    .from(documentLinks)
    .where(and(...where))
    .orderBy(
      desc(documentLinks.createdAt),
      asc(documentLinks.role),
      asc(documentLinks.id),
    )
    .all();
  const paged = paginateArray(rows, page.cursor, page.limit);
  return {
    items: linkViews(ctx, userId, paged.items),
    nextCursor: paged.nextCursor,
  };
}

/** Where each of these documents is used (for lists of documents), by external id. */
export function linkSummaries(
  ctx: Db,
  provider: DocumentProviderKind,
  externalIds: readonly number[],
): Map<number, LinkSummary[]> {
  const out = new Map<number, LinkSummary[]>();
  if (externalIds.length === 0) return out;
  const rows = ctx.db
    .select()
    .from(documentLinks)
    .where(
      and(
        eq(documentLinks.provider, provider),
        inArray(documentLinks.externalId, [...externalIds]),
      ),
    )
    .orderBy(asc(documentLinks.createdAt), asc(documentLinks.id))
    .all();
  for (const row of rows) {
    const summary: LinkSummary = {
      linkId: row.id,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      ownerTitle: ownerInfo(ctx.db, row.ownerType, row.ownerId)?.title ?? null,
      role: row.role,
    };
    out.set(row.externalId, [...(out.get(row.externalId) ?? []), summary]);
  }
  return out;
}

/** Linked rows of one document, oldest first. */
export function linksOfDocument(
  ctx: Db,
  provider: DocumentProviderKind,
  externalId: number,
): LinkRow[] {
  return ctx.db
    .select()
    .from(documentLinks)
    .where(
      and(
        eq(documentLinks.provider, provider),
        eq(documentLinks.externalId, externalId),
      ),
    )
    .orderBy(asc(documentLinks.createdAt), asc(documentLinks.id))
    .all();
}

/**
 * What follows a new link: an asset gets its warranty dates from a receipt or warranty document,
 * the other people's caches are asked to catch up (they may see the document too), and when the
 * connection asks for it the document gets a note with the hauswart link (in the background:
 * the link never fails because the document system is slow).
 */
export function afterLinkCreated(
  ctx: Now,
  session: DocumentSession,
  link: LinkRow,
): void {
  if (
    link.ownerType === "asset" &&
    (WARRANTY_ROLES as readonly string[]).includes(link.role)
  ) {
    applyDocumentWarranties(ctx, { assetId: link.ownerId });
  }
  emitEvent("documentLinksChanged", { ctx });
  if (!session.config.writeBackNotes) return;
  const owner = ownerInfo(ctx.db, link.ownerType, link.ownerId);
  if (!owner) return;
  const text = linkNoteText(session.config, owner.url);
  trackBackground(
    session.provider.addNote(session.connection, link.externalId, text),
    "documents.note_failed",
  );
}

/**
 * Links a document to something. The person's own account must be able to read the document
 * (404 otherwise), so nobody can attach a document they have no access to; what the account saw
 * is cached.
 */
export async function createLink(
  ctx: Now,
  userId: string,
  input: CreateDocumentLinkRequest,
): Promise<LinkRow> {
  if (!ownerInfo(ctx.db, input.ownerType, input.ownerId)) {
    throw invalidField("ownerId", "Owner does not exist");
  }
  const session = documentSession(ctx, input.provider, userId);
  const meta = await viaProvider(() =>
    session.provider.get(session.connection, input.externalId),
  );
  if (!meta) {
    markInvisible(ctx, session.row.id, input.provider, [input.externalId]);
    throw notFound("Document");
  }
  upsertDocuments(ctx, session.row.id, input.provider, [meta]);
  let link: LinkRow;
  try {
    link = ctx.db
      .insert(documentLinks)
      .values({
        provider: input.provider,
        externalId: input.externalId,
        connectionId: session.row.id,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        role: input.role,
        label: input.label ?? null,
        createdBy: userId,
      })
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("This document is already linked there with this role");
    }
    throw err;
  }
  afterLinkCreated(ctx, session, link);
  return link;
}

export function deleteLink(ctx: Db, id: string): void {
  const removed = ctx.db
    .delete(documentLinks)
    .where(eq(documentLinks.id, id))
    .returning({ id: documentLinks.id })
    .all();
  if (removed.length === 0) throw notFound("Document link");
}
