import { and, eq, inArray } from "drizzle-orm";
import { assetNotes } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

/**
 * The notes a service log entry says it addressed must exist and belong to the entry's asset,
 * else a 400 on `field`. Returns the distinct ids.
 */
export function assertNotesOfAsset(
  ctx: Db,
  assetId: string,
  noteIds: readonly string[],
  field = "resolvedNoteIds",
): string[] {
  const ids = [...new Set(noteIds)];
  if (ids.length === 0) return ids;
  const found = new Set(
    ctx.db
      .select({ id: assetNotes.id })
      .from(assetNotes)
      .where(and(eq(assetNotes.assetId, assetId), inArray(assetNotes.id, ids)))
      .all()
      .map((row) => row.id),
  );
  if (ids.some((id) => !found.has(id))) {
    throw invalidField(field, "Every note must exist and belong to the asset");
  }
  return ids;
}

/**
 * Marks the open notes among `noteIds` as resolved by the service log entry. Notes that are
 * resolved already stay as they are, so repeating a request changes nothing.
 */
export function resolveNotes(
  ctx: Now,
  noteIds: readonly string[],
  serviceLogId: string,
  userId: string | null,
): void {
  if (noteIds.length === 0) return;
  ctx.db
    .update(assetNotes)
    .set({
      status: "resolved",
      resolvedAt: new Date(ctx.now),
      resolvedBy: userId,
      serviceLogId,
      updatedAt: new Date(ctx.now),
    })
    .where(
      and(inArray(assetNotes.id, [...noteIds]), eq(assetNotes.status, "open")),
    )
    .run();
}

/** The notes that service log entries had resolved are open again (the entry is gone, or its completion was undone). */
export function reopenNotesOf(
  ctx: Now,
  serviceLogIds: readonly string[],
): void {
  if (serviceLogIds.length === 0) return;
  ctx.db
    .update(assetNotes)
    .set({
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      serviceLogId: null,
      updatedAt: new Date(ctx.now),
    })
    .where(inArray(assetNotes.serviceLogId, [...serviceLogIds]))
    .run();
}
