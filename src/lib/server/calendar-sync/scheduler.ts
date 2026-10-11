import { CALENDAR_PROVIDERS } from "$lib/api/enums";
import { dueForAttempt } from "$lib/server/connections/connections";
import { getDB } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { buildDesiredItems } from "./items";
import { listLinks } from "./links";
import { hasPendingChanges } from "./reconcile";
import {
  configOf,
  getTargetRow,
  listRunnableTargets,
  type TargetRow,
} from "./store";
import { syncTarget } from "./sync";

/** Every target is synced at least this often, to notice events somebody deleted in the calendar. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** How often hauswart looks for changes of its own that are waiting to be written. */
export const CHECK_INTERVAL_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 30_000;
const KICK_DELAY_MS = 2_000;

export interface SchedulerOptions {
  intervalMs?: number;
  checkIntervalMs?: number;
  firstRunDelayMs?: number;
  /** Wait this long after a change before syncing, so a burst of edits causes one run. */
  kickDelayMs?: number;
  /** The most calendar calls one run of a target makes (see `syncTarget`). */
  maxOperations?: number;
  clock?: () => number;
}

const errorName = (err: unknown) =>
  err instanceof Error ? err.name : "NonError";

/**
 * Keeps every calendar target current. Every minute it looks, without calling any calendar, whether
 * something hauswart knows has changed since the last sync (a new appointment, a completed task, a
 * moved deadline) and syncs those targets; every 15 minutes every target is synced regardless, which
 * is how events somebody deleted in the calendar are noticed. A target that is saved, and one
 * whose connection changed, is synced after a short pause ignoring the back-off; a completion
 * (which moves the next due date) has the targets looked at soon. Targets that failed back off
 * 1, 2, 4 ... 15 minutes and are tried again once that is over. Runs never overlap (a request during a run is run once more afterwards),
 * a failing run is logged by code and tried again at the next tick, the timers do not keep the
 * process alive; the returned function stops everything.
 */
export function startCalendarSyncScheduler(
  options: SchedulerOptions = {},
): () => void {
  const clock = options.clock ?? Date.now;
  const interval = options.intervalMs ?? SYNC_INTERVAL_MS;
  let running = false;
  let again = false;
  const forced = new Set<string>();

  const due = async (row: TargetRow, now: number): Promise<"sync" | "skip"> => {
    const ctx = { db: getDB(), now };
    if (forced.delete(row.id)) return "sync";
    if (!dueForAttempt(row, now)) return "skip";
    // A failed run is tried again as soon as its back-off is over, whatever else is pending.
    if (row.consecutiveFailures > 0) return "sync";
    if (!row.lastCheckedAt || now - row.lastCheckedAt.getTime() >= interval) {
      return "sync";
    }
    const desired = await buildDesiredItems(ctx, {
      config: configOf(row),
      userId: row.userId,
    });
    return hasPendingChanges(desired, listLinks(ctx, row.id)) ? "sync" : "skip";
  };

  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const db = getDB();
      for (const listed of listRunnableTargets({ db })) {
        const ctx = { db, now: clock() };
        // Re-read: an earlier target of this run may have taken a while.
        const row = getTargetRow(ctx, listed.id);
        if (!row?.enabled) continue;
        try {
          if ((await due(row, ctx.now)) === "skip") continue;
          const result = await syncTarget(ctx, row.id, {
            maxOperations: options.maxOperations,
          });
          if (result.error?.code === "busy") {
            // Somebody else's run for this target is going on: the request is not lost, it comes round again.
            forced.add(row.id);
            kick();
          } else if (result.ok && result.counts.remaining > 0) {
            // Only after a good run: a failed one has to wait out its back-off.
            forced.add(row.id);
            again = true;
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "calendar_sync.target_failed",
              name: errorName(err),
            }),
          );
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "calendar_sync.scheduler_failed",
          name: errorName(err),
        }),
      );
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };

  let kickTimer: ReturnType<typeof setTimeout> | null = null;
  const kick = () => {
    if (kickTimer) clearTimeout(kickTimer);
    kickTimer = setTimeout(() => {
      kickTimer = null;
      void run();
    }, options.kickDelayMs ?? KICK_DELAY_MS);
    kickTimer.unref?.();
  };

  const first = setTimeout(
    () => void run(),
    options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS,
  );
  const timer = setInterval(
    () => void run(),
    options.checkIntervalMs ?? CHECK_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();

  const offTarget = onEvent("calendarTargetChanged", ({ targetId }) => {
    forced.add(targetId);
    kick();
  });
  const offConnection = onEvent("connectionChanged", ({ ctx, kind }) => {
    if (!(CALENDAR_PROVIDERS as readonly string[]).includes(kind)) return;
    for (const row of listRunnableTargets(ctx)) {
      if (row.provider === kind) forced.add(row.id);
    }
    kick();
  });
  const offRecorded = onEvent("completionRecorded", kick);
  const offRevoked = onEvent("completionRevoked", kick);

  return () => {
    clearTimeout(first);
    clearInterval(timer);
    if (kickTimer) clearTimeout(kickTimer);
    offTarget();
    offConnection();
    offRecorded();
    offRevoked();
  };
}
