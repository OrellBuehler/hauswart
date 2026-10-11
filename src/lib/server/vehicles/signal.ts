import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { zonedTimeToInstant } from "$lib/dates";
import { MANUAL_SIGNAL_SOURCE } from "$lib/tasks/engine";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { householdTimeZone } from "$lib/server/config";
import {
  odometerReadings,
  signalSamples,
  signals,
  taskState,
} from "$lib/server/db";
import { upsertSignals, type SignalChange } from "$lib/server/signals/service";
import { tasksReading } from "$lib/server/signals/watch";
import type { ServiceContext } from "$lib/server/service";
import { odometerUnitOf, readingOrder } from "./summary";

type Ctx = Pick<ServiceContext, "db" | "now">;

const SAMPLE_BATCH = 500;

/**
 * When a reading counts as having been taken: noon of its date in the household zone, or the
 * moment it was entered when that was earlier (a reading dated today and entered this morning).
 * Derived from the row alone, so the history can be rebuilt at any time.
 */
function instantOf(reading: { date: string; createdAt: Date }): number {
  return Math.min(
    zonedTimeToInstant(reading.date, "12:00", householdTimeZone()),
    reading.createdAt.getTime(),
  );
}

/** Forgets the signal of a vehicle's odometer, with its history; its readings are not touched. */
export function forgetOdometerSignal(
  ctx: Pick<ServiceContext, "db">,
  assetId: string,
): void {
  const key = odometerSignalKey(assetId);
  ctx.db.delete(signalSamples).where(eq(signalSamples.key, key)).run();
  ctx.db.delete(signals).where(eq(signals.key, key)).run();
}

/**
 * A counter task remembers the first value it saw until a completion snapshots one. That value
 * came from a reading; when the reading is deleted or corrected, the remembered value would
 * stay and count from a number the vehicle never showed (a typo of 960000 against a real 96000
 * makes the task due at once). Forget a starting value that no reading has any more, so the next
 * evaluation starts again from what the vehicle really shows.
 */
function forgetStaleBaselines(ctx: Ctx, assetId: string): void {
  const key = odometerSignalKey(assetId);
  const ids = tasksReading(ctx, [key]);
  if (ids.length === 0) return;
  ctx.db
    .update(taskState)
    .set({ counterBaseline: null, updatedAt: new Date(ctx.now) })
    .where(
      and(
        inArray(taskState.taskId, ids),
        isNotNull(taskState.counterBaseline),
        sql`not exists (select 1 from ${odometerReadings} where ${odometerReadings.assetId} = ${assetId} and ${odometerReadings.value} = ${taskState.counterBaseline})`,
      ),
    )
    .run();
}

/**
 * Makes the engine's view of a vehicle's odometer match its readings, which are the source of
 * truth: the newest reading becomes the signal `odometer:<asset id>` (source `manual`, so it never
 * goes stale) and every reading is a sample at the moment it was taken, which is what estimates
 * are drawn from. Returns what changed in the signal; nothing when the newest value is the same
 * as before. A vehicle without readings has no signal. Run it in the transaction of the change.
 */
export function syncOdometerSignal(ctx: Ctx, assetId: string): SignalChange[] {
  const key = odometerSignalKey(assetId);
  const readings = ctx.db
    .select({
      date: odometerReadings.date,
      value: odometerReadings.value,
      createdAt: odometerReadings.createdAt,
    })
    .from(odometerReadings)
    .where(eq(odometerReadings.assetId, assetId))
    .orderBy(...readingOrder("asc"))
    .all();
  forgetStaleBaselines(ctx, assetId);
  if (readings.length === 0) {
    forgetOdometerSignal(ctx, assetId);
    return [];
  }
  const latest = readings[readings.length - 1];
  const { changes } = upsertSignals(
    ctx,
    [
      {
        key,
        numeric: latest.value,
        text: String(latest.value),
        unit: odometerUnitOf(ctx.db, assetId),
        changedAt: instantOf(latest),
      },
    ],
    MANUAL_SIGNAL_SOURCE,
  );

  // One sample per moment; of two readings taken at the same moment the one entered last stays.
  const samples = new Map<number, number>();
  for (const reading of readings) {
    samples.set(instantOf(reading), reading.value);
  }
  ctx.db.delete(signalSamples).where(eq(signalSamples.key, key)).run();
  const rows = [...samples].map(([at, value]) => ({
    key,
    at: new Date(at),
    value,
  }));
  for (let i = 0; i < rows.length; i += SAMPLE_BATCH) {
    ctx.db
      .insert(signalSamples)
      .values(rows.slice(i, i + SAMPLE_BATCH))
      .run();
  }
  return changes;
}
