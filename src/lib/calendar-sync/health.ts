import type { CalendarTarget } from "$lib/api/schemas/calendar-sync";

/**
 * How a target is doing, as one state for the badge and the tone of its row.
 * `paused`: switched off. `offline`: switched on, but the connection it writes through is not active, so nothing is synced.
 * `error`: the last run failed. `waiting`: no run has finished yet. `ok`: the last run worked.
 */
export type TargetState = "paused" | "offline" | "error" | "waiting" | "ok";

export function targetState(
  target: Pick<CalendarTarget, "enabled" | "status" | "lastCheckedAt">,
  connectionUsable: boolean,
): TargetState {
  if (!target.enabled) return "paused";
  if (!connectionUsable) return "offline";
  if (target.status === "error") return "error";
  if (target.status === "unknown" || target.lastCheckedAt === null) {
    return "waiting";
  }
  return "ok";
}

/** Whether the first run of a target is still to come (it is switched on and nothing was attempted yet). */
export function awaitsFirstRun(
  target: Pick<CalendarTarget, "enabled" | "lastCheckedAt">,
  connectionUsable: boolean,
): boolean {
  return target.enabled && connectionUsable && target.lastCheckedAt === null;
}
