import { backoffMs } from "$lib/server/connections/connections";
import type { TargetRow } from "./store";

/** Every target is synced at least this often, to notice events somebody deleted in the calendar. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Not before when the scheduler looks at the target again: the last attempt plus the back-off after
 * failures (1, 2, 4 ... 15 minutes), else plus the regular interval. Changes of hauswart's own can
 * bring a run forward, and the scheduler checks once a minute. Null for a target that is switched off
 * or was never tried.
 */
export function nextAttemptAt(
  row: Pick<TargetRow, "enabled" | "lastCheckedAt" | "consecutiveFailures">,
): Date | null {
  if (!row.enabled || !row.lastCheckedAt) return null;
  const wait =
    row.consecutiveFailures > 0
      ? backoffMs(row.consecutiveFailures)
      : SYNC_INTERVAL_MS;
  return new Date(row.lastCheckedAt.getTime() + wait);
}
