import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AssetNoteStatus } from "$lib/api/enums";
import type {
  CreateAssetNoteRequest,
  UpdateAssetNoteRequest,
} from "$lib/api/schemas/asset-notes";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { assetNotes, assets, users, type DB } from "$lib/server/db";
import {
  getDefect,
  insertDefect,
  type DefectRecord,
} from "$lib/server/defects/defects";
import { paginateArray } from "$lib/server/pagination";
import { conflict, notFound, type ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type AssetNoteRow = typeof assetNotes.$inferSelect;
export interface AssetNoteRecord extends AssetNoteRow {
  assetName: string;
  createdByName: string | null;
  resolvedByName: string | null;
}

const author = alias(users, "note_author");
const resolver = alias(users, "note_resolver");

const selectNotes = (db: DB) =>
  db
    .select({
      note: assetNotes,
      assetName: assets.name,
      createdByName: sql<
        string | null
      >`coalesce(${author.displayName}, ${author.username})`,
      resolvedByName: sql<
        string | null
      >`coalesce(${resolver.displayName}, ${resolver.username})`,
      rowid: sql<number>`${assetNotes}.rowid`,
    })
    .from(assetNotes)
    .innerJoin(assets, eq(assets.id, assetNotes.assetId))
    .leftJoin(author, eq(author.id, assetNotes.createdBy))
    .leftJoin(resolver, eq(resolver.id, assetNotes.resolvedBy));

type Joined = {
  note: AssetNoteRow;
  assetName: string;
  createdByName: string | null;
  resolvedByName: string | null;
};
const toRecord = (j: Joined): AssetNoteRecord => ({
  ...j.note,
  assetName: j.assetName,
  createdByName: j.createdByName,
  resolvedByName: j.resolvedByName,
});

function assertAsset(ctx: Db, assetId: string) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
}

export function getNote(ctx: Db, id: string): AssetNoteRecord {
  const row = selectNotes(ctx.db).where(eq(assetNotes.id, id)).get();
  if (!row) throw notFound("Note");
  return toRecord(row);
}

/** Newest first; `status` `all` lists open and resolved notes. */
export function listNotes(
  ctx: Db,
  assetId: string,
  filter: { status: AssetNoteStatus | "all" },
  page: { cursor?: string; limit: number },
) {
  assertAsset(ctx, assetId);
  const where = [eq(assetNotes.assetId, assetId)];
  if (filter.status !== "all") {
    where.push(eq(assetNotes.status, filter.status));
  }
  const rows = selectNotes(ctx.db)
    .where(and(...where))
    .orderBy(desc(assetNotes.createdAt), desc(sql`${assetNotes}.rowid`))
    .all()
    .map(toRecord);
  return paginateArray(rows, page.cursor, page.limit);
}

export function createNote(
  ctx: Now,
  assetId: string,
  input: CreateAssetNoteRequest,
  createdBy: string | null,
): AssetNoteRecord {
  assertAsset(ctx, assetId);
  const row = ctx.db
    .insert(assetNotes)
    .values({
      assetId,
      body: input.body,
      createdBy,
      createdAt: new Date(ctx.now),
      updatedAt: new Date(ctx.now),
    })
    .returning({ id: assetNotes.id })
    .get();
  return getNote(ctx, row.id);
}

/**
 * Resolving records who and when; reopening clears that and forgets the service log entry that had
 * addressed the issue. Asking for the status a note already has changes nothing.
 */
export function updateNote(
  ctx: Now,
  id: string,
  patch: UpdateAssetNoteRequest,
  userId: string | null,
): AssetNoteRecord {
  const current = getNote(ctx, id);
  const resolving = patch.status === "resolved" && current.status === "open";
  const reopening = patch.status === "open" && current.status === "resolved";
  ctx.db
    .update(assetNotes)
    .set({
      ...(patch.body === undefined ? {} : { body: patch.body }),
      ...(resolving
        ? {
            status: "resolved" as const,
            resolvedAt: new Date(ctx.now),
            resolvedBy: userId,
          }
        : {}),
      ...(reopening
        ? {
            status: "open" as const,
            resolvedAt: null,
            resolvedBy: null,
            serviceLogId: null,
          }
        : {}),
      updatedAt: new Date(ctx.now),
    })
    .where(eq(assetNotes.id, id))
    .run();
  return getNote(ctx, id);
}

/** Removes the note with its attachments (the photos of the issue). */
export function deleteNote(ctx: Now, id: string): void {
  getNote(ctx, id);
  ctx.db.delete(assetNotes).where(eq(assetNotes.id, id)).run();
  removeOwnedAttachments(ctx, "asset_note", id);
}

/** The first non-empty line of the note, cut to the length of a defect title. */
export function titleOfNote(body: string): string {
  const first =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return first.length <= 200 ? first : `${first.slice(0, 199)}…`;
}

/**
 * Turns the note into a defect on its asset (title from the first line, description the whole
 * text, discovered the day the note was written) and marks the note resolved with a link to it,
 * in one transaction. The defect gets no deadline: a note is an issue to mention to a mechanic or
 * installer, not a claim against the builder, so the handover deadline of the household is not
 * assumed; set one on the defect if it applies. A note that is already a defect is a conflict.
 */
export function noteToDefect(
  ctx: ServiceContext,
  id: string,
  userId: string | null,
): { note: AssetNoteRecord; defect: DefectRecord } {
  const note = getNote(ctx, id);
  if (note.defectId !== null) {
    throw conflict("The note was already turned into a defect");
  }
  const defectId = ctx.db.transaction((tx) => {
    const inner = { ...ctx, db: tx as unknown as DB };
    const created = insertDefect(
      inner,
      {
        title: titleOfNote(note.body),
        descriptionMd: note.body,
        severity: "medium",
        assetId: note.assetId,
        discoveredOn: clockAt(note.createdAt.getTime()).today,
        deadlineDate: null,
      },
      userId,
    );
    tx.update(assetNotes)
      .set({
        defectId: created,
        ...(note.status === "open"
          ? {
              status: "resolved" as const,
              resolvedAt: new Date(ctx.now),
              resolvedBy: userId,
            }
          : {}),
        updatedAt: new Date(ctx.now),
      })
      .where(eq(assetNotes.id, id))
      .run();
    return created;
  });
  return { note: getNote(ctx, id), defect: getDefect(ctx, defectId) };
}
