import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  dueForAttempt,
  listEnabledConnections,
  recordConnectionFailure,
  recordConnectionOk,
  resolveConnection,
  type ConnectionRow,
} from "$lib/server/connections/connections";
import {
  connections,
  documentLinks,
  externalDocumentSync,
  externalDocuments,
} from "$lib/server/db";
import { markInvisible, upsertDocuments } from "$lib/server/documents/cache";
import { parseProviderConfig } from "$lib/server/documents/session";
import { applyDocumentWarranties } from "$lib/server/documents/warranty";
import type { ServiceContext } from "$lib/server/service";
import { KIND, clientFor } from "./connection";
import { errorCode } from "./errors";
import { loadTaxonomy, toExternalMeta } from "./mapping";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Changed documents are asked for from this long before the newest one seen, so a tie never hides one. */
const OVERLAP_MS = 1_000;
const PAGE = 100;

export type SyncResult =
  | { status: "backoff" }
  | { status: "failed"; code: string; failures: number }
  | {
      status: "ok";
      full: boolean;
      /** Documents read and stored (changed ones, plus every linked one). */
      stored: number;
      /** Linked documents the account could not see. */
      hidden: number;
      /** Rows dropped by a full read because nothing needs them any more. */
      removed: number;
    };

function logFailure(code: string): void {
  // The short code only: messages can carry addresses, bodies never reach them.
  console.error(JSON.stringify({ event: "paperless.sync_failed", code }));
}

/** Tags whose documents are synced: the household's, the receipts and the manuals. */
export function scopeTags(config: {
  sharedTagIds: number[];
  receiptTagIds: number[];
  manualTagIds: number[];
}): number[] {
  return [
    ...new Set([
      ...config.sharedTagIds,
      ...config.receiptTagIds,
      ...config.manualTagIds,
    ]),
  ].sort((a, b) => a - b);
}

/** What a cache was built from; a different value means the cache is read again from scratch. */
function scopeHashOf(config: ReturnType<typeof parseProviderConfig>): string {
  return JSON.stringify([
    scopeTags(config),
    config.warrantyFieldId ?? null,
    config.warrantyExtendedFieldId ?? null,
  ]);
}

/** Documents that links point at, as far as this connection's instance is concerned. */
function linkedDocumentIds(
  ctx: Pick<ServiceContext, "db">,
  row: ConnectionRow,
) {
  const sameInstance = ctx.db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.kind, KIND), eq(connections.baseUrl, row.baseUrl)),
    );
  return [
    ...new Set(
      ctx.db
        .select({ id: documentLinks.externalId })
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.provider, KIND),
            or(
              isNull(documentLinks.connectionId),
              inArray(documentLinks.connectionId, sameInstance),
            ),
          ),
        )
        .all()
        .map((r) => r.id),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Reads one person's view of the documents into the cache: the changed documents with a tag of
 * the scope (all of them on the first read, after a change of address or scope, and once a day,
 * which also drops documents that left the scope or the account's view) and, every time, every
 * document a link points at. A linked document the account cannot see is kept as "not visible"
 * without its content. The warranty dates of assets that follow their documents are updated
 * afterwards. Skips while the connection backs off after failures (1, 2, 4 ... 15 minutes),
 * unless `ignoreBackoff`; the outcome is recorded on the connection.
 */
export async function syncConnection(
  ctx: ServiceContext,
  row: ConnectionRow,
  options: { ignoreBackoff?: boolean; full?: boolean } = {},
): Promise<SyncResult> {
  if (!options.ignoreBackoff && !dueForAttempt(row, ctx.now)) {
    return { status: "backoff" };
  }
  try {
    const config = parseProviderConfig(row.configJson);
    const client = clientFor(resolveConnection(row));
    const taxonomy = await loadTaxonomy(client);
    const tags = scopeTags(config);
    const hash = scopeHashOf(config);
    const state = ctx.db
      .select()
      .from(externalDocumentSync)
      .where(eq(externalDocumentSync.connectionId, row.id))
      .get();
    const full =
      options.full === true ||
      !state ||
      state.baseUrl !== row.baseUrl ||
      state.scopeHash !== hash ||
      !state.lastFullAt ||
      ctx.now - state.lastFullAt.getTime() > DAY_MS;

    let newest = full ? null : (state?.lastModified ?? null);
    let stored = 0;
    if (tags.length > 0) {
      const after =
        !full && newest !== null
          ? new Date(Date.parse(newest) - OVERLAP_MS).toISOString()
          : undefined;
      for await (const page of client.iterateDocuments({
        tagsAny: tags,
        ordering: "modified",
        pageSize: PAGE,
        modifiedAfter: after,
      })) {
        upsertDocuments(
          ctx,
          row.id,
          KIND,
          page.map((d) => toExternalMeta(d, taxonomy, config)),
        );
        stored += page.length;
        for (const doc of page) {
          if (
            doc.modified &&
            (newest === null || Date.parse(doc.modified) > Date.parse(newest))
          ) {
            newest = doc.modified;
          }
        }
      }
    }
    if (!full && newest === null) newest = state?.lastModified ?? null;

    let hidden = 0;
    const linked = linkedDocumentIds(ctx, row);
    for (let i = 0; i < linked.length; i += PAGE) {
      const ids = linked.slice(i, i + PAGE);
      const page = await client.listDocuments({ idIn: ids, pageSize: PAGE });
      const found = new Set(page.results.map((d) => d.id));
      upsertDocuments(
        ctx,
        row.id,
        KIND,
        page.results.map((d) => toExternalMeta(d, taxonomy, config)),
      );
      stored += page.results.length;
      const missing = ids.filter((id) => !found.has(id));
      markInvisible(ctx, row.id, KIND, missing);
      hidden += missing.length;
    }

    let removed = 0;
    if (full) {
      removed = ctx.db
        .delete(externalDocuments)
        .where(
          and(
            eq(externalDocuments.connectionId, row.id),
            lt(externalDocuments.syncedAt, new Date(ctx.now)),
          ),
        )
        .returning({ id: externalDocuments.id })
        .all().length;
    }

    const next = {
      baseUrl: row.baseUrl,
      scopeHash: hash,
      lastModified: newest,
      lastFullAt: full ? new Date(ctx.now) : (state?.lastFullAt ?? null),
    };
    ctx.db
      .insert(externalDocumentSync)
      .values({ connectionId: row.id, ...next })
      .onConflictDoUpdate({
        target: externalDocumentSync.connectionId,
        set: { ...next, updatedAt: new Date(ctx.now) },
      })
      .run();

    applyDocumentWarranties(ctx);
    recordConnectionOk(ctx, row.id);
    return { status: "ok", full, stored, hidden, removed };
  } catch (err) {
    const code = errorCode(err);
    logFailure(code);
    return {
      status: "failed",
      code,
      failures: recordConnectionFailure(ctx, row, code),
    };
  }
}

/** Syncs every enabled connection, one after the other. */
export async function syncAll(
  ctx: ServiceContext,
  options: { ignoreBackoff?: boolean } = {},
): Promise<Map<string, SyncResult>> {
  const results = new Map<string, SyncResult>();
  for (const row of listEnabledConnections(ctx, KIND)) {
    results.set(row.id, await syncConnection(ctx, row, options));
  }
  return results;
}
