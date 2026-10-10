import { and, eq, gt, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import type { OdometerSource } from "$lib/api/enums";
import { MAX_ODOMETER_VALUE } from "$lib/api/schemas/vehicles";
import { isValidDate } from "$lib/dates";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import { assets, odometerReadings, type DB } from "$lib/server/db";
import { generateNotifications } from "$lib/server/notifications/generate";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { settleSignalChanges } from "$lib/server/signals/ingest";
import type { SignalChange } from "$lib/server/signals/service";
import { tasksReading } from "$lib/server/signals/watch";
import { evaluateTasks } from "$lib/server/tasks/evaluator";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { syncOdometerSignal } from "./signal";
import { readingOrder } from "./summary";

type Ctx = Pick<ServiceContext, "db" | "now">;

export type OdometerRow = typeof odometerReadings.$inferSelect;

export interface OdometerInput {
  assetId: string;
  /** `YYYY-MM-DD`; not in the future. */
  date: string;
  value: number;
  source: OdometerSource;
  /** The record the reading comes from; saving the same source and record again changes that reading instead of adding one. */
  sourceId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  /** Accept a value lower than the reading before (a replaced instrument cluster). */
  force?: boolean;
}

/** Which request field each kind of problem is reported on; the default is the odometer endpoint's own body. */
export interface OdometerFields {
  date: string;
  value: string;
  /** The field to blame when the asset is no vehicle; none means the request as a whole. */
  asset: string | null;
}

const OWN_FIELDS: OdometerFields = {
  date: "date",
  value: "value",
  asset: null,
};

export interface OdometerWrite {
  reading: OdometerRow;
  /** What changed in the signal the tasks read; empty when the newest value stayed. */
  changes: SignalChange[];
}

function notAVehicle(field: string | null): ApiError {
  const message = "Only vehicles have an odometer";
  return field
    ? invalidField(field, message)
    : new ApiError("invalid_request", message);
}

/**
 * Stores a reading and brings the signal the tasks read up to date, in one transaction (the
 * caller's, when it has one). Synchronous so completions and service log entries can write their
 * reading in their own transaction; the follow-up work (re-evaluating tasks, notifications) is
 * `settleOdometer`, which `recordOdometer` runs for you.
 *
 * A value lower than the reading before (the latest one on or before the date) or higher than the
 * reading after (the first one on a later date) is a 400 on the value field, unless `force`. A reading with a `sourceId` that already has one updates it.
 */
export function writeOdometer(
  ctx: Ctx,
  input: OdometerInput,
  fields: OdometerFields = OWN_FIELDS,
): OdometerWrite {
  return ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const asset = inner.db
      .select({ kind: assets.kind })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .get();
    if (!asset) throw notFound("Asset");
    if (asset.kind !== "vehicle") throw notAVehicle(fields.asset);
    if (!isValidDate(input.date)) {
      throw invalidField(fields.date, "Expected a valid YYYY-MM-DD date");
    }
    if (input.date > dateInZone(ctx.now, householdTimeZone())) {
      throw invalidField(fields.date, "Must not be in the future");
    }
    if (
      !Number.isFinite(input.value) ||
      input.value < 0 ||
      input.value > MAX_ODOMETER_VALUE
    ) {
      throw invalidField(
        fields.value,
        `Must be a number from 0 to ${MAX_ODOMETER_VALUE}`,
      );
    }

    const existing = input.sourceId
      ? inner.db
          .select()
          .from(odometerReadings)
          .where(
            and(
              eq(odometerReadings.source, input.source),
              eq(odometerReadings.sourceId, input.sourceId),
            ),
          )
          .get()
      : undefined;

    if (!input.force) {
      const before = inner.db
        .select()
        .from(odometerReadings)
        .where(
          and(
            eq(odometerReadings.assetId, input.assetId),
            lte(odometerReadings.date, input.date),
            existing ? ne(odometerReadings.id, existing.id) : undefined,
          ),
        )
        .orderBy(...readingOrder("desc"))
        .limit(1)
        .get();
      if (before && input.value < before.value) {
        throw invalidField(
          fields.value,
          `Lower than the reading of ${before.value} on ${before.date}; send force to take it anyway`,
        );
      }
      const after = inner.db
        .select()
        .from(odometerReadings)
        .where(
          and(
            eq(odometerReadings.assetId, input.assetId),
            gt(odometerReadings.date, input.date),
            existing ? ne(odometerReadings.id, existing.id) : undefined,
          ),
        )
        .orderBy(...readingOrder("asc"))
        .limit(1)
        .get();
      if (after && input.value > after.value) {
        throw invalidField(
          fields.value,
          `Higher than the later reading of ${after.value} on ${after.date}; send force to take it anyway`,
        );
      }
    }

    let reading: OdometerRow;
    if (existing) {
      reading = inner.db
        .update(odometerReadings)
        .set({
          assetId: input.assetId,
          date: input.date,
          value: input.value,
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .where(eq(odometerReadings.id, existing.id))
        .returning()
        .get();
    } else {
      reading = inner.db
        .insert(odometerReadings)
        .values({
          assetId: input.assetId,
          date: input.date,
          value: input.value,
          source: input.source,
          sourceId: input.sourceId ?? null,
          note: input.note ?? null,
          createdBy: input.createdBy ?? null,
          createdAt: new Date(ctx.now),
        })
        .returning()
        .get();
    }
    const changes = syncOdometerSignal(inner, input.assetId);
    // A reading that moved to another vehicle leaves the signal of the first one behind.
    if (existing && existing.assetId !== input.assetId) {
      changes.push(...syncOdometerSignal(inner, existing.assetId));
    }
    return { reading, changes };
  });
}

/**
 * What follows a change of readings: tasks that count on the odometer are re-evaluated (so due
 * dates and estimates move at once, not at the next tick) and what became due is announced.
 * `changes` are those `writeOdometer` returned; with them the full signal follow-up runs
 * (auto-complete rules, hint reactions), without only the re-evaluation.
 */
export async function settleOdometer(
  ctx: ServiceContext,
  assetId: string,
  changes: readonly SignalChange[] = [],
): Promise<void> {
  if (changes.length > 0) {
    await settleSignalChanges(ctx, changes);
    return;
  }
  await refreshOdometerReaders(ctx, assetId);
}

/** Re-evaluates the tasks whose trigger reads this vehicle's odometer and announces what became due. */
export async function refreshOdometerReaders(
  ctx: ServiceContext,
  assetId: string,
): Promise<void> {
  const ids = tasksReading(ctx, [odometerSignalKey(assetId)]);
  if (ids.length === 0) return;
  await evaluateTasks(ctx, ids);
  await generateNotifications(ctx);
}

/**
 * Records an odometer reading of a vehicle and lets the tasks that count on it know. This is the
 * entry point for everything that learns the odometer on the side (fuel logs, tire changes, ...).
 */
export async function recordOdometer(
  ctx: ServiceContext,
  input: OdometerInput,
  fields: OdometerFields = OWN_FIELDS,
): Promise<OdometerRow> {
  const { reading, changes } = writeOdometer(ctx, input, fields);
  await settleOdometer(ctx, reading.assetId, changes);
  return reading;
}

function resync(
  ctx: Ctx,
  rows: readonly Pick<OdometerRow, "assetId">[],
): SignalChange[] {
  const changes: SignalChange[] = [];
  for (const assetId of new Set(rows.map((r) => r.assetId))) {
    changes.push(...syncOdometerSignal(ctx, assetId));
  }
  return changes;
}

/** Deletes a reading; the vehicle's newest one (if any) becomes the signal. */
export function removeReading(
  ctx: Ctx,
  id: string,
): { assetId: string; changes: SignalChange[] } {
  return ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const row = inner.db
      .delete(odometerReadings)
      .where(eq(odometerReadings.id, id))
      .returning()
      .get();
    if (!row) throw notFound("Odometer reading");
    return { assetId: row.assetId, changes: resync(inner, [row]) };
  });
}

export async function deleteOdometerReading(
  ctx: ServiceContext,
  id: string,
): Promise<void> {
  const { assetId, changes } = removeReading(ctx, id);
  await settleOdometer(ctx, assetId, changes);
}

/** Deletes the readings a record wrote (its completion was undone, its service log entry deleted or cleared). */
export function removeReadingsOfSource(
  ctx: Ctx,
  source: OdometerSource,
  sourceId: string,
): SignalChange[] {
  return ctx.db.transaction((tx) => {
    const inner: Ctx = { ...ctx, db: tx as unknown as DB };
    const rows = inner.db
      .delete(odometerReadings)
      .where(
        and(
          eq(odometerReadings.source, source),
          eq(odometerReadings.sourceId, sourceId),
        ),
      )
      .returning()
      .all();
    return resync(inner, rows);
  });
}

const cursorSchema = z.object({
  d: z.string(),
  t: z.number().int(),
  r: z.number().int(),
});

/** Newest first by date, then by when it was entered; keyset pages on (date, createdAt, rowid). */
export function listReadings(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
  page: { cursor?: string; limit: number },
) {
  const asset = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!asset) throw notFound("Asset");
  const where: SQL[] = [eq(odometerReadings.assetId, assetId)];
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(odometerReadings.date, at.d),
        and(
          eq(odometerReadings.date, at.d),
          or(
            lt(odometerReadings.createdAt, new Date(at.t)),
            and(
              eq(odometerReadings.createdAt, new Date(at.t)),
              lt(sql`${odometerReadings}.rowid`, at.r),
            ),
          ),
        ),
      ) as SQL,
    );
  }
  const rows = ctx.db
    .select({
      reading: odometerReadings,
      rowid: sql<number>`${odometerReadings}.rowid`,
    })
    .from(odometerReadings)
    .where(and(...where))
    .orderBy(...readingOrder("desc"))
    .limit(page.limit + 1)
    .all();
  const paged = pageOf(rows, page.limit, (r) => ({
    d: r.reading.date,
    t: r.reading.createdAt.getTime(),
    r: r.rowid,
  }));
  return {
    items: paged.items.map((r) => r.reading),
    nextCursor: paged.nextCursor,
  };
}
