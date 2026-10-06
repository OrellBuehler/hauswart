import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import type { AttachmentOwnerType } from "$lib/api/enums";
import type { UpdateAttachmentRequest } from "$lib/api/schemas/attachments";
import { assets, attachments } from "$lib/server/db";
import {
  defaultFilesRoot,
  deleteIfUnreferenced,
  openFile,
  putFile,
} from "$lib/server/files/store";
import { paginateArray } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { isOwnerTypeSupported, ownerExists } from "./owners";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type AttachmentRecord = typeof attachments.$inferSelect;

export interface NewAttachment {
  bytes: Uint8Array;
  filename: string;
  declaredMime?: string;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  caption?: string | null;
  guestVisible?: boolean;
  uploadedBy: string | null;
  /** Files directory; defaults to `HAUSWART_FILES_DIR`. */
  root?: string;
}

const errorName = (err: unknown) =>
  err instanceof Error ? err.name : "NonError";

type ChangeListener = (attachmentIds: string[]) => void;
const listeners = new Set<ChangeListener>();

/**
 * Called with the ids of attachments that were deleted or whose guest visibility changed, so
 * that cached renderings that embed them can be refreshed (see `docs/pages.ts`). Returns a
 * function that removes the listener.
 */
export function onAttachmentsChanged(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function emitChanged(ids: string[]): void {
  if (ids.length === 0) return;
  for (const listener of listeners) listener(ids);
}

const pending = new Set<Promise<unknown>>();

/** Tracks a background task so tests (and shutdown) can wait for it; failures are logged. */
export function trackBackground(task: Promise<unknown>, event: string): void {
  const tracked: Promise<unknown> = task
    .catch((err: unknown) => {
      console.error(JSON.stringify({ event, name: errorName(err) }));
    })
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
}

/** Resolves when every background sweep or re-render started so far has finished. */
export async function settleBackgroundWork(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

function isShaReferenced(db: Db["db"], sha256: string): boolean {
  return (
    db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.sha256, sha256))
      .limit(1)
      .get() !== undefined
  );
}

/** Deletes the stored file (and thumbnail) when no attachment row uses it any more. */
export async function sweepStoredFile(
  ctx: Now,
  sha256: string,
  root: string = defaultFilesRoot(),
): Promise<boolean> {
  return deleteIfUnreferenced(
    root,
    sha256,
    (sha) => isShaReferenced(ctx.db, sha),
    { now: ctx.now },
  );
}

export async function createAttachment(
  ctx: Now,
  input: NewAttachment,
): Promise<AttachmentRecord> {
  if (!isOwnerTypeSupported(input.ownerType)) {
    throw invalidField("ownerType", "Attachments are not available for this");
  }
  if (!ownerExists(ctx, input.ownerType, input.ownerId)) {
    throw invalidField("ownerId", "Owner does not exist");
  }
  const stored = await putFile(input.root ?? defaultFilesRoot(), input.bytes, {
    filename: input.filename,
    declaredMime: input.declaredMime,
  });
  return ctx.db
    .insert(attachments)
    .values({
      sha256: stored.sha256,
      path: stored.path,
      thumbPath: stored.thumbPath,
      mime: stored.mime,
      size: stored.size,
      width: stored.width,
      height: stored.height,
      filename: stored.filename,
      caption: input.caption ? input.caption : null,
      guestVisible: input.guestVisible ?? false,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      uploadedBy: input.uploadedBy,
    })
    .returning()
    .get();
}

export function findAttachment(
  ctx: Db,
  id: string,
): AttachmentRecord | undefined {
  return ctx.db.select().from(attachments).where(eq(attachments.id, id)).get();
}

export function getAttachment(ctx: Db, id: string): AttachmentRecord {
  const row = findAttachment(ctx, id);
  if (!row) throw notFound("Attachment");
  return row;
}

export function listAttachments(
  ctx: Db,
  owner: { ownerType: AttachmentOwnerType; ownerId: string },
  page: { cursor?: string; limit: number },
) {
  const rows = ctx.db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, owner.ownerType),
        eq(attachments.ownerId, owner.ownerId),
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
  return paginateArray(rows, page.cursor, page.limit);
}

/** The attachments among `ids`, by id. */
export function attachmentsById(
  ctx: Db,
  ids: readonly string[],
): Map<string, AttachmentRecord> {
  if (ids.length === 0) return new Map();
  return new Map(
    ctx.db
      .select()
      .from(attachments)
      .where(inArray(attachments.id, [...ids]))
      .all()
      .map((row) => [row.id, row]),
  );
}

export function updateAttachment(
  ctx: Db,
  id: string,
  patch: UpdateAttachmentRequest,
): AttachmentRecord {
  const current = getAttachment(ctx, id);
  const updated = ctx.db
    .update(attachments)
    .set({
      ...(patch.caption === undefined ? {} : { caption: patch.caption }),
      ...(patch.guestVisible === undefined
        ? {}
        : { guestVisible: patch.guestVisible }),
    })
    .where(eq(attachments.id, id))
    .returning()
    .get();
  if (
    patch.guestVisible !== undefined &&
    patch.guestVisible !== current.guestVisible
  ) {
    emitChanged([id]);
  }
  return updated;
}

/** Removes the row, clears an asset photo that pointed at it and sweeps the file when unused. */
export async function deleteAttachment(
  ctx: Now,
  id: string,
  root: string = defaultFilesRoot(),
): Promise<void> {
  const row = getAttachment(ctx, id);
  ctx.db.transaction((tx) => {
    tx.update(assets)
      .set({ photoAttachmentId: null })
      .where(eq(assets.photoAttachmentId, id))
      .run();
    tx.delete(attachments).where(eq(attachments.id, id)).run();
  });
  emitChanged([id]);
  await sweepStoredFile(ctx, row.sha256, root);
}

/**
 * Deletes every attachment of an owner. Domains call this from their delete service (synchronous,
 * inside the same request); the stored files are swept in the background.
 */
export function removeOwnedAttachments(
  ctx: Now,
  type: AttachmentOwnerType,
  ownerId: string,
): void {
  const rows = ctx.db
    .delete(attachments)
    .where(
      and(eq(attachments.ownerType, type), eq(attachments.ownerId, ownerId)),
    )
    .returning()
    .all();
  if (rows.length === 0) return;
  emitChanged(rows.map((row) => row.id));
  const root = defaultFilesRoot();
  const shas = [...new Set(rows.map((row) => row.sha256))];
  trackBackground(
    Promise.all(shas.map((sha) => sweepStoredFile(ctx, sha, root))),
    "attachments.sweep_failed",
  );
}

/** An asset's photo must be an image that belongs to that asset. */
export function assertAssetPhoto(
  ctx: Db,
  assetId: string,
  attachmentId: string,
): void {
  const row = ctx.db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.ownerType, "asset"),
        eq(attachments.ownerId, assetId),
        like(attachments.mime, "image/%"),
      ),
    )
    .get();
  if (!row) {
    throw invalidField(
      "photoAttachmentId",
      "Must be an image attachment of this asset",
    );
  }
}

export async function openAttachmentFile(
  row: AttachmentRecord,
  variant: "content" | "thumb",
  root: string = defaultFilesRoot(),
): Promise<ReturnType<typeof Bun.file> | null> {
  const path = variant === "thumb" ? row.thumbPath : row.path;
  if (!path) return null;
  return openFile(root, path);
}

const SHA_FILE = /^[0-9a-f]{64}$/;
const TEMP_FILE = /\.tmp$/;
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

/**
 * Housekeeping for the files directory: deletes stored files no attachment row references (left
 * behind by a failed upload, a deletion within the first minute of a file's life, or a crash)
 * and temp files of interrupted writes older than a day. Returns what it removed.
 */
export async function sweepOrphanFiles(
  ctx: Now,
  root: string = defaultFilesRoot(),
): Promise<{ files: number; temps: number }> {
  let files = 0;
  let temps = 0;
  let shards: string[];
  try {
    shards = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { files, temps };
    }
    throw err;
  }
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    for (const name of await readdir(join(root, shard))) {
      const full = join(root, shard, name);
      if (SHA_FILE.test(name)) {
        if (await sweepStoredFile(ctx, name, root)) files += 1;
      } else if (TEMP_FILE.test(name)) {
        const info = await stat(full);
        if (ctx.now - info.mtimeMs > STALE_TEMP_MS) {
          await unlink(full);
          temps += 1;
        }
      }
    }
  }
  return { files, temps };
}
