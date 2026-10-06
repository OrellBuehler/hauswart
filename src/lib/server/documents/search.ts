import { and, eq, inArray, sql } from "drizzle-orm";
import { DOCUMENT_PROVIDERS } from "$lib/api/enums";
import { documentLinks, externalDocuments } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { ownerInfo } from "./owners";
import { ownConnectionRow } from "./session";

type Db = Pick<ServiceContext, "db">;

export interface DocumentSearchHit {
  /** `<provider>:<externalId>` */
  id: string;
  title: string;
  /** Where the document is used, first link: its owner's title. */
  snippet: string;
  /** The first thing the document is linked to. */
  url: string;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Titles (never the text of a document) of linked documents that match every word of `text`.
 * Only documents the caller's own connection can read are searched, so a document somebody else
 * linked from their private account never shows up for the caller.
 */
export function searchLinkedDocuments(
  ctx: Db,
  userId: string,
  text: string,
  limit: number,
): DocumentSearchHit[] {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 8);
  if (!words || limit < 1) return [];
  const out: DocumentSearchHit[] = [];
  for (const kind of DOCUMENT_PROVIDERS) {
    const row = ownConnectionRow(ctx, kind, userId);
    if (!row) continue;
    const docs = ctx.db
      .select()
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.connectionId, row.id),
          eq(externalDocuments.ownerVisible, true),
          ...words.map(
            (w) =>
              sql`lower(${externalDocuments.title}) like ${`%${escapeLike(w)}%`} escape '\\'`,
          ),
          inArray(
            externalDocuments.externalId,
            ctx.db
              .select({ id: documentLinks.externalId })
              .from(documentLinks)
              .where(eq(documentLinks.provider, kind)),
          ),
        ),
      )
      .all();
    for (const doc of docs) {
      const links = ctx.db
        .select()
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.provider, kind),
            eq(documentLinks.externalId, doc.externalId),
          ),
        )
        .orderBy(documentLinks.createdAt, documentLinks.id)
        .all();
      for (const link of links) {
        const owner = ownerInfo(ctx.db, link.ownerType, link.ownerId);
        if (!owner) continue;
        out.push({
          id: `${kind}:${doc.externalId}`,
          title: doc.title,
          snippet: owner.title,
          url: owner.url,
        });
        break;
      }
    }
  }
  return out
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, "de") || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
