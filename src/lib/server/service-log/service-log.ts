import { and, desc, eq, gte, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { ServiceLogKind } from "$lib/api/enums";
import type {
  CompletionServiceLogRequest,
  CreateServiceLogRequest,
  UpdateServiceLogRequest,
} from "$lib/api/schemas/service-log";
import { minor } from "$lib/money";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { assets, contacts, serviceLog, type DB } from "$lib/server/db";
import {
  assertNotesOfAsset,
  reopenNotesOf,
  resolveNotes,
} from "$lib/server/asset-notes/resolve";
import { commentCountSql } from "$lib/server/comments/counts";
import { costsOfSql, type CostsOf } from "$lib/server/costs/totals";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import {
  removeReadingsOfSource,
  writeOdometer,
} from "$lib/server/vehicles/odometer";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type ServiceLogRow = typeof serviceLog.$inferSelect;
export interface ServiceLogRecord extends ServiceLogRow {
  assetName: string;
  contactName: string | null;
  commentCount: number;
  costs: CostsOf;
}

const selectEntries = (db: DB) =>
  db
    .select({
      entry: serviceLog,
      assetName: assets.name,
      contactName: contacts.name,
      commentCount: commentCountSql("service_log", serviceLog.id),
      costTotal: costsOfSql("service_log_id", serviceLog.id).total,
      costCount: costsOfSql("service_log_id", serviceLog.id).count,
      rowid: sql<number>`${serviceLog}.rowid`,
    })
    .from(serviceLog)
    .innerJoin(assets, eq(assets.id, serviceLog.assetId))
    .leftJoin(contacts, eq(contacts.id, serviceLog.contactId));

type Joined = {
  entry: ServiceLogRow;
  rowid: number;
  assetName: string;
  contactName: string | null;
  commentCount: number;
  costTotal: number;
  costCount: number;
};
const toRecord = ({
  entry,
  assetName,
  contactName,
  commentCount,
  costTotal,
  costCount,
}: Joined): ServiceLogRecord => ({
  ...entry,
  assetName,
  contactName,
  commentCount: Number(commentCount),
  costs: { totalMinor: Number(costTotal), count: Number(costCount) },
});

const cursorSchema = z.object({
  d: z.string(),
  t: z.number().int(),
  r: z.number().int(),
});

export interface ServiceLogFilter {
  assetId?: string;
  kind?: ServiceLogKind;
  from?: string;
  to?: string;
}

/** Newest first by date, then by when it was entered; keyset pages on (date, createdAt, id). */
export function listServiceLog(
  ctx: Db,
  filter: ServiceLogFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (filter.assetId) where.push(eq(serviceLog.assetId, filter.assetId));
  if (filter.kind) where.push(eq(serviceLog.kind, filter.kind));
  if (filter.from) where.push(gte(serviceLog.date, filter.from));
  if (filter.to) where.push(lte(serviceLog.date, filter.to));
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(serviceLog.date, at.d),
        and(
          eq(serviceLog.date, at.d),
          or(
            lt(serviceLog.createdAt, new Date(at.t)),
            and(
              eq(serviceLog.createdAt, new Date(at.t)),
              lt(sql`${serviceLog}.rowid`, at.r),
            ),
          ),
        ),
      ) as SQL,
    );
  }
  const rows = selectEntries(ctx.db)
    .where(and(...where))
    .orderBy(
      desc(serviceLog.date),
      desc(serviceLog.createdAt),
      desc(sql`${serviceLog}.rowid`),
    )
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    d: r.entry.date,
    t: r.entry.createdAt.getTime(),
    r: r.rowid,
  }));
  return { items: paged.items.map(toRecord), nextCursor: paged.nextCursor };
}

export function getEntry(ctx: Db, id: string): ServiceLogRecord {
  const row = selectEntries(ctx.db).where(eq(serviceLog.id, id)).get();
  if (!row) throw notFound("Service log entry");
  return toRecord(row);
}

/** An entry that belongs to this asset; anything else is a 404. */
export function getAssetEntry(
  ctx: Db,
  assetId: string,
  entryId: string,
): ServiceLogRecord {
  const entry = getEntry(ctx, entryId);
  if (entry.assetId !== assetId) throw notFound("Service log entry");
  return entry;
}

function assertAsset(ctx: Db, assetId: string) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
}

export function assertContact(ctx: Db, contactId: string | null | undefined) {
  if (!contactId) return;
  const hit = ctx.db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  if (!hit) throw invalidField("contactId", "Contact does not exist");
}

/** Cost and currency go together: a cost gets the household's currency unless one is given. */
function costFields(
  ctx: Db,
  costMinor: number | null | undefined,
  currency: string | null | undefined,
) {
  if (costMinor === undefined || costMinor === null) {
    return { costMinor: null, currency: null };
  }
  return {
    costMinor: minor(costMinor),
    currency: currency ?? getHousehold(ctx).currency,
  };
}

/**
 * The vehicle reading that goes with an entry's odometer value, kept in step with it: written (or
 * moved to the entry's date) when the entry has a value, removed when it has none. A value lower
 * than the reading before it is a 400 on `odometer`; an asset that is no vehicle cannot take one.
 */
function syncEntryReading(
  ctx: Now,
  entry: {
    id: string;
    assetId: string;
    date: string;
    odometer: number | null;
    createdBy: string | null;
  },
): void {
  if (entry.odometer === null) {
    removeReadingsOfSource(ctx, "service_log", entry.id);
    return;
  }
  writeOdometer(
    ctx,
    {
      assetId: entry.assetId,
      date: entry.date,
      value: entry.odometer,
      source: "service_log",
      sourceId: entry.id,
      createdBy: entry.createdBy,
    },
    { date: "date", value: "odometer", asset: "odometer" },
  );
}

export function listAssetEntries(
  ctx: Db,
  assetId: string,
  filter: { kind?: ServiceLogKind },
  page: { cursor?: string; limit: number },
) {
  assertAsset(ctx, assetId);
  return listServiceLog(ctx, { assetId, kind: filter.kind }, page);
}

export function createEntry(
  ctx: Now,
  assetId: string,
  input: CreateServiceLogRequest,
  createdBy: string | null,
  link: { completionId?: string | null } = {},
): ServiceLogRecord {
  assertAsset(ctx, assetId);
  assertContact(ctx, input.contactId);
  const date = input.date ?? clockAt(ctx.now).today;
  const odometer = input.odometer ?? null;
  const noteIds = assertNotesOfAsset(ctx, assetId, input.resolvedNoteIds ?? []);
  const id = ctx.db.transaction((tx) => {
    const row = tx
      .insert(serviceLog)
      .values({
        assetId,
        date,
        kind: input.kind,
        title: input.title,
        descriptionMd: input.descriptionMd,
        contactId: input.contactId ?? null,
        completionId: link.completionId ?? null,
        ...costFields(ctx, input.costMinor, input.currency),
        odometer,
        performedBy: input.performedBy ?? null,
        createdBy,
      })
      .returning({ id: serviceLog.id })
      .get();
    syncEntryReading(
      { ...ctx, db: tx as unknown as DB },
      { id: row.id, assetId, date, odometer, createdBy },
    );
    resolveNotes(
      { db: tx as unknown as DB, now: ctx.now },
      noteIds,
      row.id,
      createdBy,
    );
    return row.id;
  });
  return getEntry(ctx, id);
}

export function updateEntry(
  ctx: Now,
  assetId: string,
  entryId: string,
  patch: UpdateServiceLogRequest,
  userId: string | null = null,
): ServiceLogRecord {
  const current = getAssetEntry(ctx, assetId, entryId);
  if (patch.contactId !== undefined) assertContact(ctx, patch.contactId);
  const { costMinor, currency, resolvedNoteIds, ...rest } = patch;
  const noteIds = assertNotesOfAsset(ctx, assetId, resolvedNoteIds ?? []);
  const touchesCost = costMinor !== undefined || currency !== undefined;
  const nextCost = costMinor !== undefined ? costMinor : current.costMinor;
  const odometer =
    patch.odometer !== undefined ? patch.odometer : current.odometer;
  const date = patch.date ?? current.date;
  ctx.db.transaction((tx) => {
    tx.update(serviceLog)
      .set({
        ...rest,
        ...(touchesCost
          ? costFields(ctx, nextCost, currency ?? current.currency)
          : {}),
        // Also set when only notes are resolved, which touches no column of the entry.
        updatedAt: new Date(ctx.now),
      })
      .where(eq(serviceLog.id, entryId))
      .run();
    // The reading follows the entry's value and date.
    if (
      patch.odometer !== undefined ||
      (patch.date !== undefined && current.odometer !== null)
    ) {
      syncEntryReading(
        { ...ctx, db: tx as unknown as DB },
        {
          id: entryId,
          assetId,
          date,
          odometer,
          createdBy: current.createdBy,
        },
      );
    }
    resolveNotes(
      { db: tx as unknown as DB, now: ctx.now },
      noteIds,
      entryId,
      userId,
    );
  });
  return getEntry(ctx, entryId);
}

/** The notes the entry had resolved are open again; its attachments go with it. */
export function deleteEntry(ctx: Now, assetId: string, entryId: string): void {
  getAssetEntry(ctx, assetId, entryId);
  ctx.db.transaction((tx) => {
    reopenNotesOf({ db: tx as unknown as DB, now: ctx.now }, [entryId]);
    tx.delete(serviceLog).where(eq(serviceLog.id, entryId)).run();
    // The reading it wrote goes with it.
    removeReadingsOfSource(
      { ...ctx, db: tx as unknown as DB },
      "service_log",
      entryId,
    );
  });
  removeOwnedAttachments(ctx, "service_log", entryId);
}

/**
 * The service log entry that goes with a completion. Checked before the task
 * is completed (so a bad request changes nothing) and written right after.
 */
export function checkCompletionLog(
  ctx: Db,
  task: { assetId: string | null },
  input: CompletionServiceLogRequest,
): string {
  if (!task.assetId) {
    throw invalidField(
      "serviceLog",
      "The task has no asset to log the work on",
    );
  }
  assertContact(ctx, input.contactId);
  assertNotesOfAsset(
    ctx,
    task.assetId,
    input.resolvedNoteIds ?? [],
    "serviceLog",
  );
  return task.assetId;
}

export function logCompletion(
  ctx: Now,
  completionId: string,
  task: { assetId: string; title: string },
  input: CompletionServiceLogRequest,
  completedDate: string,
  createdBy: string | null,
): ServiceLogRecord {
  const existing = ctx.db
    .select({ id: serviceLog.id })
    .from(serviceLog)
    .where(eq(serviceLog.completionId, completionId))
    .get();
  if (existing) return getEntry(ctx, existing.id);
  return createEntry(
    ctx,
    task.assetId,
    {
      date: completedDate,
      kind: input.kind,
      title: input.title ?? task.title,
      descriptionMd: input.descriptionMd ?? "",
      contactId: input.contactId,
      costMinor: input.costMinor,
      resolvedNoteIds: input.resolvedNoteIds,
    },
    createdBy,
    { completionId },
  );
}

/** The entry written with a completion, if any. */
export function entryOfCompletion(
  ctx: Db,
  completionId: string,
): ServiceLogRecord | null {
  const row = ctx.db
    .select({ id: serviceLog.id })
    .from(serviceLog)
    .where(eq(serviceLog.completionId, completionId))
    .get();
  return row ? getEntry(ctx, row.id) : null;
}
