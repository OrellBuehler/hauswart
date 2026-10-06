import { and, eq, inArray } from "drizzle-orm";
import { DOCUMENT_PROVIDERS, type DocumentProviderKind } from "$lib/api/enums";
import { contacts, documentLinks, externalDocuments } from "$lib/server/db";
import { notFound, type ServiceContext } from "$lib/server/service";
import { toMeta } from "./cache";
import type { ExternalDocumentMeta } from "./provider";
import { ownConnectionRow, parseProviderConfig } from "./session";

type Db = Pick<ServiceContext, "db">;

/** `contacts.externalSource` of contacts that stand for a correspondent of a document system. */
export const CORRESPONDENT_SOURCE = "document_correspondent";

/**
 * `contacts.externalRef` of the contact for a correspondent: `<provider>:<correspondentId>`. It is
 * provider-scoped, not connection-scoped, because contacts belong to the household: two people
 * who connect the same document system must not get two contacts for one correspondent (the
 * household is assumed to use one instance per provider).
 */
export const correspondentRef = (
  provider: DocumentProviderKind,
  correspondentId: number,
): string => `${provider}:${correspondentId}`;

export interface AssetSuggestion {
  provider: DocumentProviderKind;
  meta: ExternalDocumentMeta;
}

export interface ContactSuggestion {
  provider: DocumentProviderKind;
  correspondentId: number;
  name: string;
  documentCount: number;
  externalSource: string;
  externalRef: string;
}

function ownConnections(ctx: Db, userId: string) {
  const rows = DOCUMENT_PROVIDERS.flatMap((kind) => {
    const row = ownConnectionRow(ctx, kind, userId);
    return row ? [{ kind, row }] : [];
  });
  if (rows.length === 0) throw notFound("Connection");
  return rows;
}

/**
 * Receipts the caller's account synced (tagged as receipts in the connection settings) that
 * carry a warranty date and are linked to no asset yet: candidates for the inventory. Built from
 * the caller's own cache only, so nobody is offered somebody else's documents.
 */
export function assetSuggestions(ctx: Db, userId: string): AssetSuggestion[] {
  const out: AssetSuggestion[] = [];
  for (const { kind, row } of ownConnections(ctx, userId)) {
    const receiptTags = parseProviderConfig(row.configJson).receiptTagIds;
    if (receiptTags.length === 0) continue;
    const docs = ctx.db
      .select()
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.connectionId, row.id),
          eq(externalDocuments.ownerVisible, true),
        ),
      )
      .all()
      .filter(
        (d) =>
          d.tagIds.some((t) => receiptTags.includes(t)) &&
          (d.customFieldsJson.warrantyUntil ||
            d.customFieldsJson.warrantyExtendedUntil),
      );
    if (docs.length === 0) continue;
    const linked = new Set(
      ctx.db
        .select({ id: documentLinks.externalId })
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.provider, kind),
            eq(documentLinks.ownerType, "asset"),
            inArray(
              documentLinks.externalId,
              docs.map((d) => d.externalId),
            ),
          ),
        )
        .all()
        .map((l) => l.id),
    );
    for (const doc of docs) {
      if (!linked.has(doc.externalId)) {
        out.push({ provider: kind, meta: toMeta(doc) });
      }
    }
  }
  return out.sort(
    (a, b) =>
      (b.meta.createdDate ?? "").localeCompare(a.meta.createdDate ?? "") ||
      a.meta.title.localeCompare(b.meta.title, "de") ||
      a.meta.externalId - b.meta.externalId,
  );
}

/** Correspondents of the caller's synced documents that no contact stands for yet. */
export function contactSuggestions(
  ctx: Db,
  userId: string,
): ContactSuggestion[] {
  const known = new Set(
    ctx.db
      .select({ ref: contacts.externalRef })
      .from(contacts)
      .where(eq(contacts.externalSource, CORRESPONDENT_SOURCE))
      .all()
      .map((c) => c.ref),
  );
  const out: ContactSuggestion[] = [];
  for (const { kind, row } of ownConnections(ctx, userId)) {
    const docs = ctx.db
      .select({
        id: externalDocuments.correspondentId,
        name: externalDocuments.correspondentName,
      })
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.connectionId, row.id),
          eq(externalDocuments.ownerVisible, true),
        ),
      )
      .all();
    const counts = new Map<number, { name: string; count: number }>();
    for (const doc of docs) {
      if (doc.id === null || !doc.name) continue;
      const seen = counts.get(doc.id);
      if (seen) seen.count += 1;
      else counts.set(doc.id, { name: doc.name, count: 1 });
    }
    for (const [correspondentId, { name, count }] of counts) {
      const externalRef = correspondentRef(kind, correspondentId);
      if (known.has(externalRef)) continue;
      out.push({
        provider: kind,
        correspondentId,
        name,
        documentCount: count,
        externalSource: CORRESPONDENT_SOURCE,
        externalRef,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "de") ||
      a.correspondentId - b.correspondentId,
  );
}
