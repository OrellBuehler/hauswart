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
import { commentCountSql } from "$lib/server/comments/counts";
import { getHousehold } from "$lib/server/household/household";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type ServiceLogRow = typeof serviceLog.$inferSelect;
export interface ServiceLogRecord extends ServiceLogRow {
  assetName: string;
  contactName: string | null;
  commentCount: number;
}

const selectEntries = (db: DB) =>
  db
    .select({
      entry: serviceLog,
      assetName: assets.name,
      contactName: contacts.name,
      commentCount: commentCountSql("service_log", serviceLog.id),
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
};
const toRecord = ({
  entry,
  assetName,
  contactName,
  commentCount,
}: Joined): ServiceLogRecord => ({
  ...entry,
  assetName,
  contactName,
  commentCount: Number(commentCount),
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
  const row = ctx.db
    .insert(serviceLog)
    .values({
      assetId,
      date: input.date ?? clockAt(ctx.now).today,
      kind: input.kind,
      title: input.title,
      descriptionMd: input.descriptionMd,
      contactId: input.contactId ?? null,
      completionId: link.completionId ?? null,
      ...costFields(ctx, input.costMinor, input.currency),
      performedBy: input.performedBy ?? null,
      createdBy,
    })
    .returning({ id: serviceLog.id })
    .get();
  return getEntry(ctx, row.id);
}

export function updateEntry(
  ctx: Db,
  assetId: string,
  entryId: string,
  patch: UpdateServiceLogRequest,
): ServiceLogRecord {
  const current = getAssetEntry(ctx, assetId, entryId);
  if (patch.contactId !== undefined) assertContact(ctx, patch.contactId);
  const { costMinor, currency, ...rest } = patch;
  const touchesCost = costMinor !== undefined || currency !== undefined;
  const nextCost = costMinor !== undefined ? costMinor : current.costMinor;
  ctx.db
    .update(serviceLog)
    .set({
      ...rest,
      ...(touchesCost
        ? costFields(ctx, nextCost, currency ?? current.currency)
        : {}),
    })
    .where(eq(serviceLog.id, entryId))
    .run();
  return getEntry(ctx, entryId);
}

export function deleteEntry(ctx: Now, assetId: string, entryId: string): void {
  getAssetEntry(ctx, assetId, entryId);
  ctx.db.delete(serviceLog).where(eq(serviceLog.id, entryId)).run();
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
