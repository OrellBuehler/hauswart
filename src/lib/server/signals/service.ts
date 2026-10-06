import { and, desc, eq, lt, max, notInArray } from "drizzle-orm";
import { externalDates, signalSamples, signals } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

/** A numeric sample is written when the value changes and at least this often. */
export const SAMPLE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SAMPLE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** A signal nobody has read for this long is forgotten. */
export const SIGNAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** What an adapter read: the value of one external thing at one moment. */
export interface SignalReading {
  key: string;
  /** Null when the value is not a number. */
  numeric: number | null;
  /** The raw state; null when the source has no value. */
  text: string | null;
  unit?: string | null;
  /** When the value last changed at the source (ms since the epoch). */
  changedAt: number;
}

export interface SignalValue {
  numeric: number | null;
  text: string | null;
  changedAt: number;
}

export interface SignalChange {
  key: string;
  /** Null the first time the signal is seen. */
  prev: SignalValue | null;
  next: SignalValue;
}

export interface UpsertResult {
  changes: SignalChange[];
  /** Readings that carried no value (unavailable); the last known value stays. */
  skipped: number;
}

type Db = Pick<ServiceContext, "db" | "now">;

function sameValue(a: SignalValue, b: SignalValue): boolean {
  if (a.numeric !== null && b.numeric !== null) return a.numeric === b.numeric;
  return a.numeric === b.numeric && a.text === b.text;
}

/**
 * Stores readings. A reading without a value (unavailable, unknown) is
 * skipped on purpose: the last known value stays, so a counter that was
 * briefly unavailable can still be seen dropping afterwards, and the
 * evaluator marks the signal stale once nothing valid arrives for a day.
 * Samples (numeric history) are written when the value changes and at least
 * every six hours. Returns what changed; the first sight of a signal counts
 * as a change with `prev` null.
 */
export function upsertSignals(
  ctx: Db,
  readings: readonly SignalReading[],
  source: string,
): UpsertResult {
  const changes: SignalChange[] = [];
  let skipped = 0;
  ctx.db.transaction((tx) => {
    for (const reading of readings) {
      if (reading.numeric === null && reading.text === null) {
        skipped += 1;
        continue;
      }
      const prevRow = tx
        .select()
        .from(signals)
        .where(eq(signals.key, reading.key))
        .get();
      const next: SignalValue = {
        numeric: reading.numeric,
        text: reading.text,
        changedAt: reading.changedAt,
      };
      const prev: SignalValue | null = prevRow
        ? {
            numeric: prevRow.numeric,
            text: prevRow.text,
            changedAt: prevRow.changedAt.getTime(),
          }
        : null;
      const changed = prev === null || !sameValue(prev, next);
      tx.insert(signals)
        .values({
          key: reading.key,
          numeric: reading.numeric,
          text: reading.text,
          unit: reading.unit ?? prevRow?.unit ?? null,
          changedAt: new Date(reading.changedAt),
          seenAt: new Date(ctx.now),
          source,
        })
        .onConflictDoUpdate({
          target: signals.key,
          set: {
            numeric: reading.numeric,
            text: reading.text,
            unit: reading.unit ?? prevRow?.unit ?? null,
            changedAt: new Date(reading.changedAt),
            seenAt: new Date(ctx.now),
            source,
          },
        })
        .run();
      if (changed) changes.push({ key: reading.key, prev, next });
      if (reading.numeric !== null) {
        const last = tx
          .select({ at: max(signalSamples.at) })
          .from(signalSamples)
          .where(eq(signalSamples.key, reading.key))
          .get()?.at;
        const lastAt = last ? new Date(last).getTime() : null;
        if (
          changed ||
          lastAt === null ||
          ctx.now - lastAt >= SAMPLE_INTERVAL_MS
        ) {
          tx.insert(signalSamples)
            .values({
              key: reading.key,
              at: new Date(ctx.now),
              value: reading.numeric,
            })
            .onConflictDoNothing()
            .run();
        }
      }
    }
  });
  return { changes, skipped };
}

export interface ExternalDateEntry {
  /** `YYYY-MM-DD` in the household time zone. */
  date: string;
  title?: string;
}

/** Replaces all dates of one subscription key; false when nothing changed. */
export function replaceExternalDates(
  ctx: Pick<ServiceContext, "db">,
  key: string,
  entries: readonly ExternalDateEntry[],
): boolean {
  const wanted = new Map<string, string>();
  for (const e of entries) {
    const title = (e.title ?? "").slice(0, 200);
    if (!wanted.has(`${e.date}\u0000${title}`)) {
      wanted.set(`${e.date}\u0000${title}`, title);
    }
  }
  return ctx.db.transaction((tx) => {
    const current = tx
      .select()
      .from(externalDates)
      .where(eq(externalDates.key, key))
      .all();
    const same =
      current.length === wanted.size &&
      current.every((r) => wanted.has(`${r.date}\u0000${r.title}`));
    if (same) return false;
    tx.delete(externalDates).where(eq(externalDates.key, key)).run();
    for (const [composite, title] of wanted) {
      const date = composite.slice(0, composite.indexOf("\u0000"));
      tx.insert(externalDates).values({ key, date, title }).run();
    }
    return true;
  });
}

/** Whether any dates are stored for the key (an adapter syncs calendars that have none). */
export function hasExternalDates(
  ctx: Pick<ServiceContext, "db">,
  key: string,
): boolean {
  return (
    ctx.db
      .select({ date: externalDates.date })
      .from(externalDates)
      .where(eq(externalDates.key, key))
      .limit(1)
      .get() !== undefined
  );
}

/** The newest readings of the given keys, for tests and diagnostics. */
export function getSignal(ctx: Pick<ServiceContext, "db">, key: string) {
  return ctx.db.select().from(signals).where(eq(signals.key, key)).get();
}

export function listSamples(ctx: Pick<ServiceContext, "db">, key: string) {
  return ctx.db
    .select()
    .from(signalSamples)
    .where(eq(signalSamples.key, key))
    .orderBy(desc(signalSamples.at))
    .all();
}

/**
 * Housekeeping: samples older than a year, signals nobody has read for 90
 * days, and calendar dates of subscriptions no task uses any more.
 */
export function pruneSignals(
  ctx: Db,
  watchedCalendarKeys: readonly string[],
): { samples: number; signals: number; dates: number } {
  const samples = ctx.db
    .delete(signalSamples)
    .where(lt(signalSamples.at, new Date(ctx.now - SAMPLE_RETENTION_MS)))
    .returning({ key: signalSamples.key })
    .all().length;
  const stale = ctx.db
    .delete(signals)
    .where(lt(signals.seenAt, new Date(ctx.now - SIGNAL_RETENTION_MS)))
    .returning({ key: signals.key })
    .all().length;
  const dates = ctx.db
    .delete(externalDates)
    .where(
      watchedCalendarKeys.length === 0
        ? undefined
        : and(notInArray(externalDates.key, [...watchedCalendarKeys])),
    )
    .returning({ key: externalDates.key })
    .all().length;
  return { samples, signals: stale, dates };
}
