import { asc, eq, max } from "drizzle-orm";
import type {
  CreateRoomRequest,
  UpdateRoomRequest,
} from "$lib/api/schemas/rooms";
import { rooms } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { slugify, uniqueSlug } from "$lib/server/slug";

export type RoomRecord = typeof rooms.$inferSelect;

type Db = Pick<ServiceContext, "db">;

export function listRooms(ctx: Db, page: { cursor?: string; limit: number }) {
  const all = ctx.db
    .select()
    .from(rooms)
    .orderBy(asc(rooms.sortOrder), asc(rooms.name), asc(rooms.id))
    .all();
  return paginateArray(all, page.cursor, page.limit);
}

export function findRoom(ctx: Db, id: string): RoomRecord | undefined {
  return ctx.db.select().from(rooms).where(eq(rooms.id, id)).get();
}

export function getRoom(ctx: Db, id: string): RoomRecord {
  const room = findRoom(ctx, id);
  if (!room) throw notFound("Room");
  return room;
}

export function findRoomBySlug(ctx: Db, slug: string) {
  return ctx.db.select().from(rooms).where(eq(rooms.slug, slug)).get();
}

function slugTaken(ctx: Db, slug: string): boolean {
  return findRoomBySlug(ctx, slug) !== undefined;
}

export function createRoom(ctx: Db, input: CreateRoomRequest): RoomRecord {
  const slug =
    input.slug ??
    uniqueSlug(slugify(input.name), (candidate) => slugTaken(ctx, candidate));
  if (input.slug && slugTaken(ctx, slug)) {
    throw conflict("A room with this slug already exists");
  }
  const nextOrder =
    (ctx.db
      .select({ m: max(rooms.sortOrder) })
      .from(rooms)
      .get()?.m ?? -1) + 1;
  try {
    return ctx.db
      .insert(rooms)
      .values({
        name: input.name,
        slug,
        haAreaId: input.haAreaId ?? null,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? nextOrder,
        notes: input.notes ?? null,
      })
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("A room with this slug already exists");
    }
    throw err;
  }
}

export function updateRoom(
  ctx: Db,
  id: string,
  patch: UpdateRoomRequest,
): RoomRecord {
  const current = getRoom(ctx, id);
  if (patch.slug && patch.slug !== current.slug && slugTaken(ctx, patch.slug)) {
    throw conflict("A room with this slug already exists");
  }
  try {
    return ctx.db
      .update(rooms)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.slug === undefined ? {} : { slug: patch.slug }),
        ...(patch.haAreaId === undefined ? {} : { haAreaId: patch.haAreaId }),
        ...(patch.icon === undefined ? {} : { icon: patch.icon }),
        ...(patch.sortOrder === undefined
          ? {}
          : { sortOrder: patch.sortOrder }),
        ...(patch.notes === undefined ? {} : { notes: patch.notes }),
      })
      .where(eq(rooms.id, id))
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("A room with this slug already exists");
    }
    throw err;
  }
}

/** Assets and tasks in the room stay; they just lose their room. */
export function deleteRoom(ctx: Db, id: string): void {
  const result = ctx.db.delete(rooms).where(eq(rooms.id, id)).returning().all();
  if (result.length === 0) throw notFound("Room");
}
