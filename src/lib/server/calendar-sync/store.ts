import { and, asc, eq } from "drizzle-orm";
import {
  calendarTargetConfigSchema,
  calendarSyncCountsSchema,
  type CalendarSyncCounts,
  type CalendarTargetCapabilities,
  type CalendarTargetConfig,
} from "$lib/api/schemas/calendar-sync";
import { calendarTargets, connections } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import type { ServiceContext } from "$lib/server/service";

/** The longest calendar name that is kept. */
export const MAX_REMOTE_NAME = 255;

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type TargetRow = typeof calendarTargets.$inferSelect;

export function getTargetRow(ctx: Db, id: string): TargetRow | undefined {
  return ctx.db
    .select()
    .from(calendarTargets)
    .where(eq(calendarTargets.id, id))
    .get();
}

/** The settings, checked again: a stored value that no longer fits is a bug or a hand edit, never silently repaired. */
export function configOf(
  row: Pick<TargetRow, "configJson">,
): CalendarTargetConfig {
  return parseStored(
    calendarTargetConfigSchema,
    row.configJson,
    "calendar target settings",
  );
}

export function statsOf(
  row: Pick<TargetRow, "lastStatsJson">,
): CalendarSyncCounts | null {
  if (row.lastStatsJson === null) return null;
  const parsed = calendarSyncCountsSchema.safeParse(row.lastStatsJson);
  if (parsed.success) return parsed.data;
  console.error(
    JSON.stringify({
      event: "calendar_sync.stats_invalid",
      codes: [...new Set(parsed.error.issues.map((issue) => issue.code))],
    }),
  );
  return null;
}

/** Targets that are switched on and whose connection is switched on, oldest first. */
export function listRunnableTargets(ctx: Db): TargetRow[] {
  return ctx.db
    .select({ target: calendarTargets })
    .from(calendarTargets)
    .innerJoin(connections, eq(connections.id, calendarTargets.connectionId))
    .where(
      and(eq(calendarTargets.enabled, true), eq(connections.enabled, true)),
    )
    .orderBy(asc(calendarTargets.createdAt), asc(calendarTargets.id))
    .all()
    .map((r) => r.target);
}

export function saveCapabilities(
  ctx: Db,
  row: Pick<TargetRow, "id" | "capabilitiesJson">,
  capabilities: CalendarTargetCapabilities,
): void {
  const known = row.capabilitiesJson;
  if (
    known &&
    known.create === capabilities.create &&
    known.update === capabilities.update &&
    known.delete === capabilities.delete &&
    known.alarms === capabilities.alarms
  ) {
    return;
  }
  ctx.db
    .update(calendarTargets)
    .set({ capabilitiesJson: capabilities })
    .where(eq(calendarTargets.id, row.id))
    .run();
}

/** The calendar's name as its system reports it now; kept apart from the target's own name. */
export function saveRemoteName(
  ctx: Db,
  row: Pick<TargetRow, "id" | "remoteName">,
  name: string,
): void {
  const value = name.slice(0, MAX_REMOTE_NAME);
  if (row.remoteName === value) return;
  ctx.db
    .update(calendarTargets)
    .set({ remoteName: value })
    .where(eq(calendarTargets.id, row.id))
    .run();
}

export function recordTargetOk(
  ctx: Now,
  id: string,
  counts: CalendarSyncCounts,
): void {
  ctx.db
    .update(calendarTargets)
    .set({
      status: "ok",
      lastError: null,
      lastOkAt: new Date(ctx.now),
      lastCheckedAt: new Date(ctx.now),
      consecutiveFailures: 0,
      lastStatsJson: counts,
    })
    .where(eq(calendarTargets.id, id))
    .run();
}

/**
 * Records a failed run and returns the number of failures in a row. A run that failed before it
 * counted anything (`counts` null) stores no counts, so the target does not show those of the run
 * before it next to the error.
 */
export function recordTargetFailure(
  ctx: Now,
  row: Pick<TargetRow, "id" | "consecutiveFailures">,
  code: string,
  counts: CalendarSyncCounts | null,
): number {
  const failures = row.consecutiveFailures + 1;
  ctx.db
    .update(calendarTargets)
    .set({
      status: "error",
      lastError: code,
      lastCheckedAt: new Date(ctx.now),
      consecutiveFailures: failures,
      lastStatsJson: counts,
    })
    .where(eq(calendarTargets.id, row.id))
    .run();
  return failures;
}
