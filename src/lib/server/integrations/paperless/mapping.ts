import type { ExternalDocumentMeta } from "$lib/server/documents/provider";
import type { DocumentProviderConfig } from "$lib/api/schemas/documents";
import type { PaperlessClient } from "./client";
import { customFieldDate, type PaperlessDocument } from "./schemas";

/** Names of tags and correspondents, so documents carry them without a lookup per document. */
export interface Taxonomy {
  tags: Map<number, string>;
  correspondents: Map<number, string>;
}

export async function loadTaxonomy(client: PaperlessClient): Promise<Taxonomy> {
  const [tags, correspondents] = await Promise.all([
    client.listTags(),
    client.listCorrespondents(),
  ]);
  return {
    tags: new Map(tags.map((t) => [t.id, t.name])),
    correspondents: new Map(correspondents.map((c) => [c.id, c.name])),
  };
}

const CACHE_MS = 60_000;
const taxonomies = new Map<string, { at: number; value: Taxonomy }>();

/** A short-lived copy per connection: interactive calls need names, not a fresh list each time. */
export async function taxonomyOf(
  connectionId: string,
  client: PaperlessClient,
  now: number = Date.now(),
): Promise<Taxonomy> {
  const cached = taxonomies.get(connectionId);
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await loadTaxonomy(client);
  taxonomies.set(connectionId, { at: now, value });
  return value;
}

/** Forgets cached names (a connection changed). */
export function clearTaxonomyCache(): void {
  taxonomies.clear();
}

/** A document in the core's neutral shape; the warranty dates come from the configured fields. */
export function toExternalMeta(
  doc: PaperlessDocument,
  taxonomy: Taxonomy,
  config: Pick<
    DocumentProviderConfig,
    "warrantyFieldId" | "warrantyExtendedFieldId"
  >,
): ExternalDocumentMeta {
  return {
    externalId: doc.id,
    title: doc.title,
    createdDate: doc.createdDate,
    modifiedAt: doc.modified,
    correspondentId: doc.correspondent,
    correspondentName:
      doc.correspondent === null
        ? null
        : (taxonomy.correspondents.get(doc.correspondent) ?? null),
    tagIds: doc.tags,
    tagNames: doc.tags.flatMap((t) => {
      const name = taxonomy.tags.get(t);
      return name === undefined ? [] : [name];
    }),
    mimeType: doc.mimeType,
    pageCount: doc.pageCount,
    noteCount: doc.noteCount,
    warrantyUntil: config.warrantyFieldId
      ? customFieldDate(doc, config.warrantyFieldId)
      : null,
    warrantyExtendedUntil: config.warrantyExtendedFieldId
      ? customFieldDate(doc, config.warrantyExtendedFieldId)
      : null,
  };
}
