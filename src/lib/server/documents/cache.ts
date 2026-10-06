import { and, eq, inArray } from "drizzle-orm";
import type { DocumentProviderKind } from "$lib/api/enums";
import { externalDocuments } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import type { ExternalDocumentMeta } from "./provider";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type CachedDocument = typeof externalDocuments.$inferSelect;

/** The cached row as the provider-neutral shape. */
export function toMeta(row: CachedDocument): ExternalDocumentMeta {
  return {
    externalId: row.externalId,
    title: row.title,
    createdDate: row.createdDate,
    modifiedAt: row.modifiedAt,
    correspondentId: row.correspondentId,
    correspondentName: row.correspondentName,
    tagIds: row.tagIds,
    tagNames: row.tagNames,
    mimeType: row.mimeType,
    pageCount: row.pageCount,
    noteCount: row.noteCount,
    warrantyUntil: row.customFieldsJson.warrantyUntil,
    warrantyExtendedUntil: row.customFieldsJson.warrantyExtendedUntil,
  };
}

const CHUNK = 100;

/** Stores what a connection's account saw of these documents (insert or update, visible). */
export function upsertDocuments(
  ctx: Now,
  connectionId: string,
  provider: DocumentProviderKind,
  metas: readonly ExternalDocumentMeta[],
): void {
  for (let i = 0; i < metas.length; i += CHUNK) {
    const rows = metas.slice(i, i + CHUNK).map((m) => ({
      provider,
      connectionId,
      externalId: m.externalId,
      title: m.title,
      createdDate: m.createdDate,
      modifiedAt: m.modifiedAt,
      correspondentId: m.correspondentId,
      correspondentName: m.correspondentName,
      tagIds: m.tagIds,
      tagNames: m.tagNames,
      mimeType: m.mimeType,
      pageCount: m.pageCount,
      customFieldsJson: {
        warrantyUntil: m.warrantyUntil,
        warrantyExtendedUntil: m.warrantyExtendedUntil,
      },
      noteCount: m.noteCount,
      ownerVisible: true,
      syncedAt: new Date(ctx.now),
    }));
    for (const row of rows) {
      ctx.db
        .insert(externalDocuments)
        .values(row)
        .onConflictDoUpdate({
          target: [
            externalDocuments.connectionId,
            externalDocuments.externalId,
          ],
          set: { ...row, updatedAt: new Date(ctx.now) },
        })
        .run();
    }
  }
}

/**
 * The connection asked for these documents and the provider did not show them: they stay as
 * not visible (so a link to one says "not shared") but nothing of their content is kept.
 */
export function markInvisible(
  ctx: Now,
  connectionId: string,
  provider: DocumentProviderKind,
  externalIds: readonly number[],
): void {
  for (const externalId of externalIds) {
    const cleared = {
      title: "",
      createdDate: null,
      modifiedAt: null,
      correspondentId: null,
      correspondentName: null,
      tagIds: [] as number[],
      tagNames: [] as string[],
      mimeType: null,
      pageCount: null,
      customFieldsJson: { warrantyUntil: null, warrantyExtendedUntil: null },
      noteCount: 0,
      ownerVisible: false,
      syncedAt: new Date(ctx.now),
    };
    ctx.db
      .insert(externalDocuments)
      .values({ provider, connectionId, externalId, ...cleared })
      .onConflictDoUpdate({
        target: [externalDocuments.connectionId, externalDocuments.externalId],
        set: { ...cleared, updatedAt: new Date(ctx.now) },
      })
      .run();
  }
}

export function findCached(
  ctx: Db,
  connectionId: string,
  externalId: number,
): CachedDocument | undefined {
  return ctx.db
    .select()
    .from(externalDocuments)
    .where(
      and(
        eq(externalDocuments.connectionId, connectionId),
        eq(externalDocuments.externalId, externalId),
      ),
    )
    .get();
}

/** The connection's rows for these documents, by external id. */
export function cachedByIds(
  ctx: Db,
  connectionId: string,
  externalIds: readonly number[],
): Map<number, CachedDocument> {
  const out = new Map<number, CachedDocument>();
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const rows = ctx.db
      .select()
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.connectionId, connectionId),
          inArray(
            externalDocuments.externalId,
            externalIds.slice(i, i + CHUNK),
          ),
        ),
      )
      .all();
    for (const row of rows) out.set(row.externalId, row);
  }
  return out;
}
