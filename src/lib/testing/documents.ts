import type { z } from "zod";
import { createAsset } from "$lib/server/assets/assets";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { saveConnection } from "$lib/server/connections/connections";
import { documentLinks, externalDocuments, type DB } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

/** An asset for tests that link documents to something. */
export function makeAsset(
  ctx: Pick<ServiceContext, "db">,
  over: Partial<z.input<typeof createAssetRequestSchema>> = {},
) {
  return createAsset(
    ctx,
    createAssetRequestSchema.parse({ name: "Dishwasher", ...over }),
  );
}

/** A person's connection to the document system (a made-up address; nothing is called). */
export function makeConnection(
  db: DB,
  userId: string,
  over: {
    baseUrl?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  } = {},
) {
  return saveConnection({ db, now: Date.now() }, "paperless", userId, {
    baseUrl: over.baseUrl ?? "https://docs.example.org",
    token: "test-token",
    allowInsecureTls: false,
    config: over.config,
    enabled: over.enabled,
  });
}

/** A document as one connection's cache holds it. */
export function cacheDocument(
  db: DB,
  connectionId: string,
  externalId: number,
  over: Partial<typeof externalDocuments.$inferInsert> = {},
) {
  return db
    .insert(externalDocuments)
    .values({
      provider: "paperless",
      connectionId,
      externalId,
      title: `Synthetic document ${externalId}`,
      syncedAt: new Date(),
      ...over,
    })
    .returning()
    .get();
}

/** A link between a document and an owner. */
export function linkDocument(
  db: DB,
  over: Partial<typeof documentLinks.$inferInsert> & {
    externalId: number;
    ownerId: string;
  },
) {
  return db
    .insert(documentLinks)
    .values({
      provider: "paperless",
      ownerType: "asset",
      role: "other",
      ...over,
    })
    .returning()
    .get();
}
