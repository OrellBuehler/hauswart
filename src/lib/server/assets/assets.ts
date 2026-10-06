import { and, asc, eq, isNull, like, or, sql, type SQL } from "drizzle-orm";
import type { AssetKind } from "$lib/api/enums";
import {
  QR_SLUG_LENGTH,
  type CreateAssetRequest,
  type UpdateAssetRequest,
} from "$lib/api/schemas/assets";
import { assets, rooms } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { slugify, uniqueSlug } from "$lib/server/slug";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type AssetRow = typeof assets.$inferSelect;
export interface AssetRecord extends AssetRow {
  roomName: string | null;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 10 characters of base32 = 50 random bits: unguessable, short enough for a QR code. */
export function generateQrSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(QR_SLUG_LENGTH));
  return Array.from(bytes, (b) => BASE32[b & 31]).join("");
}

const selectAsset = (db: Db["db"]) =>
  db
    .select({ asset: assets, roomName: rooms.name })
    .from(assets)
    .leftJoin(rooms, eq(assets.roomId, rooms.id));

type Joined = { asset: AssetRow; roomName: string | null };
const toRecord = ({ asset, roomName }: Joined): AssetRecord => ({
  ...asset,
  roomName,
});

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface AssetFilter {
  kind?: AssetKind;
  roomId?: string;
  q?: string;
  includeArchived?: boolean;
}

export function listAssets(
  ctx: Db,
  filter: AssetFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (!filter.includeArchived) where.push(isNull(assets.archivedAt));
  if (filter.kind) where.push(eq(assets.kind, filter.kind));
  if (filter.roomId) where.push(eq(assets.roomId, filter.roomId));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    const match = (column: Parameters<typeof like>[0]) =>
      sql`lower(${column}) like ${pattern} escape '\\'`;
    where.push(
      or(
        match(assets.name),
        match(assets.manufacturer),
        match(assets.model),
        match(assets.category),
        match(assets.species),
      ) as SQL,
    );
  }
  const rows = selectAsset(ctx.db)
    .where(and(...where))
    .orderBy(asc(assets.name), asc(assets.id))
    .all()
    .map(toRecord);
  return paginateArray(rows, page.cursor, page.limit);
}

export function findAsset(ctx: Db, id: string): AssetRecord | undefined {
  const row = selectAsset(ctx.db).where(eq(assets.id, id)).get();
  return row && toRecord(row);
}

export function getAsset(ctx: Db, id: string): AssetRecord {
  const asset = findAsset(ctx, id);
  if (!asset) throw notFound("Asset");
  return asset;
}

export function getAssetByQr(ctx: Db, qrSlug: string): AssetRecord {
  const row = selectAsset(ctx.db).where(eq(assets.qrSlug, qrSlug)).get();
  if (!row) throw notFound("Asset");
  return toRecord(row);
}

export function findAssetBySlug(ctx: Db, slug: string) {
  return ctx.db.select().from(assets).where(eq(assets.slug, slug)).get();
}

function assertRoom(ctx: Db, roomId: string | null | undefined) {
  if (!roomId) return;
  const room = ctx.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .get();
  if (!room) throw invalidField("roomId", "Room does not exist");
}

const slugTaken = (ctx: Db, slug: string) =>
  findAssetBySlug(ctx, slug) !== undefined;

export function createAsset(ctx: Db, input: CreateAssetRequest): AssetRecord {
  assertRoom(ctx, input.roomId);
  const slug =
    input.slug ??
    uniqueSlug(slugify(input.name), (candidate) => slugTaken(ctx, candidate));
  if (input.slug && slugTaken(ctx, slug)) {
    throw conflict("An asset with this slug already exists");
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = ctx.db
        .insert(assets)
        .values({
          kind: input.kind,
          name: input.name,
          slug,
          qrSlug: generateQrSlug(),
          roomId: input.roomId ?? null,
          category: input.category ?? null,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          purchaseDate: input.purchaseDate ?? null,
          installedDate: input.installedDate ?? null,
          warrantyUntil: input.warrantyUntil ?? null,
          warrantyExtendedUntil: input.warrantyExtendedUntil ?? null,
          showOnEmergency: input.showOnEmergency,
          notes: input.notes ?? null,
          species: input.species ?? null,
          light: input.light ?? null,
          waterNotes: input.waterNotes ?? null,
          photoAttachmentId: input.photoAttachmentId ?? null,
        })
        .returning({ id: assets.id })
        .get();
      return getAsset(ctx, row.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (slugTaken(ctx, slug)) {
        throw conflict("An asset with this slug already exists");
      }
      // The QR slug collided (about 1 in 10^15): draw another.
      if (attempt >= 5) throw err;
    }
  }
}

export function updateAsset(
  ctx: Now,
  id: string,
  patch: UpdateAssetRequest,
): AssetRecord {
  const current = getAsset(ctx, id);
  if (patch.roomId !== undefined) assertRoom(ctx, patch.roomId);
  if (patch.slug && patch.slug !== current.slug && slugTaken(ctx, patch.slug)) {
    throw conflict("An asset with this slug already exists");
  }
  const { archived, ...fields } = patch;
  try {
    ctx.db
      .update(assets)
      .set({
        ...fields,
        ...(archived === undefined
          ? {}
          : {
              archivedAt: archived
                ? (current.archivedAt ?? new Date(ctx.now))
                : null,
            }),
      })
      .where(eq(assets.id, id))
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("An asset with this slug already exists");
    }
    throw err;
  }
  return getAsset(ctx, id);
}

/** Tasks that referenced the asset stay and lose the link. */
export function deleteAsset(ctx: Db, id: string): void {
  const result = ctx.db
    .delete(assets)
    .where(eq(assets.id, id))
    .returning({ id: assets.id })
    .all();
  if (result.length === 0) throw notFound("Asset");
}
