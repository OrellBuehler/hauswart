import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { maxDate } from "$lib/dates";
import { assets, documentLinks, externalDocuments } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

type Now = Pick<ServiceContext, "db" | "now">;

/** Link roles whose document tells the warranty of the asset it is linked to. */
export const WARRANTY_ROLES = ["receipt", "warranty"] as const;

function latest(a: string | null, b: string | null): string | null {
  if (a && b) return maxDate(a, b);
  return a ?? b;
}

/**
 * Sets the warranty dates of assets from their linked receipt and warranty documents.
 *
 * An asset follows its documents while its dates are empty or came from a document
 * (`warrantySource = 'document'`); a date somebody typed (`manual`) is never overwritten. With
 * several documents the latest date of each field wins. A document without a warranty date
 * changes nothing (a document that loses its date does not erase the asset's). Each document is
 * read from the cache of the connection that linked it, else from any connection that sees it.
 * Returns the ids of the assets that changed.
 */
export function applyDocumentWarranties(
  ctx: Now,
  options: { assetId?: string } = {},
): string[] {
  const links = ctx.db
    .select({
      assetId: documentLinks.ownerId,
      provider: documentLinks.provider,
      externalId: documentLinks.externalId,
      connectionId: documentLinks.connectionId,
    })
    .from(documentLinks)
    .where(
      and(
        eq(documentLinks.ownerType, "asset"),
        inArray(documentLinks.role, [...WARRANTY_ROLES]),
        options.assetId
          ? eq(documentLinks.ownerId, options.assetId)
          : undefined,
      ),
    )
    .all();
  if (links.length === 0) return [];

  const dates = new Map<
    string,
    { until: string | null; extended: string | null }
  >();
  for (const link of links) {
    const rows = ctx.db
      .select()
      .from(externalDocuments)
      .where(
        and(
          eq(externalDocuments.provider, link.provider),
          eq(externalDocuments.externalId, link.externalId),
          eq(externalDocuments.ownerVisible, true),
        ),
      )
      .all();
    const doc =
      rows.find((r) => r.connectionId === link.connectionId) ?? rows[0];
    if (!doc) continue;
    const { warrantyUntil, warrantyExtendedUntil } = doc.customFieldsJson;
    if (!warrantyUntil && !warrantyExtendedUntil) continue;
    const seen = dates.get(link.assetId) ?? { until: null, extended: null };
    dates.set(link.assetId, {
      until: latest(seen.until, warrantyUntil),
      extended: latest(seen.extended, warrantyExtendedUntil),
    });
  }

  const changed: string[] = [];
  for (const [assetId, next] of dates) {
    const asset = ctx.db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          or(
            eq(assets.warrantySource, "document"),
            and(
              isNull(assets.warrantyUntil),
              isNull(assets.warrantyExtendedUntil),
            ),
          ),
        ),
      )
      .get();
    if (!asset) continue;
    if (
      asset.warrantyUntil === next.until &&
      asset.warrantyExtendedUntil === next.extended &&
      asset.warrantySource === "document"
    ) {
      continue;
    }
    ctx.db
      .update(assets)
      .set({
        warrantyUntil: next.until,
        warrantyExtendedUntil: next.extended,
        warrantySource: "document",
      })
      .where(eq(assets.id, assetId))
      .run();
    changed.push(assetId);
  }
  return changed;
}
