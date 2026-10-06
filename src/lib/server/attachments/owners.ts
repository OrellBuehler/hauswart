import { eq } from "drizzle-orm";
import type { AttachmentOwnerType } from "$lib/api/enums";
import { assets, docPages, rooms, tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

/** Whether the owner `id` of one type exists. Synchronous: it runs inside the upload check. */
export type OwnerExists = (ctx: Db, id: string) => boolean;

const assetExists: OwnerExists = (ctx, id) =>
  ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, id))
    .get() !== undefined;
const roomExists: OwnerExists = (ctx, id) =>
  ctx.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, id)).get() !==
  undefined;
const pageExists: OwnerExists = (ctx, id) =>
  ctx.db
    .select({ id: docPages.id })
    .from(docPages)
    .where(eq(docPages.id, id))
    .get() !== undefined;
const taskExists: OwnerExists = (ctx, id) =>
  ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get() !==
  undefined;

const owners = new Map<AttachmentOwnerType, OwnerExists>([
  ["asset", assetExists],
  ["room", roomExists],
  ["page", pageExists],
  ["task", taskExists],
]);

/**
 * Makes `type` a valid attachment owner. Attachments have no foreign keys on their owner, so a
 * domain that owns attachments (defects, service log, parts, ...) registers its existence check at
 * startup (call it from the startup hook, never from a module that is only loaded with its
 * routes) and calls `removeOwnedAttachments` from its delete service. Returns a function that
 * restores the previous check (for tests).
 */
export function registerAttachmentOwner(
  type: AttachmentOwnerType,
  exists: OwnerExists,
): () => void {
  const previous = owners.get(type);
  owners.set(type, exists);
  return () => {
    if (previous) owners.set(type, previous);
    else owners.delete(type);
  };
}

/** Withdraws `type` (uploads are refused again). Returns a function that puts the previous check back (for tests). */
export function unregisterAttachmentOwner(
  type: AttachmentOwnerType,
): () => void {
  const previous = owners.get(type);
  owners.delete(type);
  return () => {
    if (previous) owners.set(type, previous);
  };
}

export function isOwnerTypeSupported(type: AttachmentOwnerType): boolean {
  return owners.has(type);
}

export function ownerExists(
  ctx: Db,
  type: AttachmentOwnerType,
  id: string,
): boolean {
  return owners.get(type)?.(ctx, id) ?? false;
}
