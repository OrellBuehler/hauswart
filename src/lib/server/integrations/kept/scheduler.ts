import { getDB } from "$lib/server/db";
import {
  dueForAttempt,
  listEnabledConnections,
  resolveConnection,
} from "$lib/server/connections/connections";
import { onEvent } from "$lib/server/events";
import { KIND } from "./connection";
import { errorCode } from "./errors";
import { housekeeping, syncConnection, syncLinksOf } from "./sync";

export const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 45_000;
const KICK_DELAY_MS = 2_000;

export interface SchedulerOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** Wait this long after a change before syncing, so a burst of edits causes one run. */
  kickDelayMs?: number;
  clock?: () => number;
}

/**
 * Keeps every enabled Kept connection current: every 30 minutes a full sync
 * (connections that failed back off 1, 2, 4 ... 15 minutes between attempts),
 * at once for a connection that was just saved, and a links-only round shortly
 * after a cost entry booked from Kept was created, changed or deleted. Runs
 * never overlap (a request during a run is run once more afterwards), a
 * failing run is logged by code and tried again at the next tick, the timers do
 * not keep the process alive; the returned function stops everything.
 */
export function startKeptScheduler(options: SchedulerOptions = {}): () => void {
  const clock = options.clock ?? Date.now;
  let running = false;
  let again: { force: boolean } | null = null;
  const linkRounds = new Set<string>();

  const run = async (force: boolean): Promise<void> => {
    if (running) {
      again = { force: again?.force || force };
      return;
    }
    running = true;
    try {
      const db = getDB();
      for (const row of listEnabledConnections({ db }, KIND)) {
        const ctx = { db, now: clock() };
        if (!force && !dueForAttempt(row, ctx.now)) continue;
        await syncConnection(ctx, row);
      }
      await housekeeping({ db, now: clock() });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "kept.scheduler_failed",
          code: errorCode(err),
        }),
      );
    } finally {
      running = false;
      const next = again;
      again = null;
      if (next) void run(next.force);
    }
  };

  const linkRound = async (): Promise<void> => {
    const ids = [...linkRounds];
    linkRounds.clear();
    for (const id of ids) {
      try {
        const db = getDB();
        const ctx = { db, now: clock() };
        const owned = enabledConnection(db, id);
        if (!owned) continue;
        await syncLinksOf(ctx, owned, resolveConnection(owned));
      } catch (err) {
        console.error(
          JSON.stringify({ event: "kept.links_failed", code: errorCode(err) }),
        );
      }
    }
  };

  const kickTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const kick = (name: string, action: () => void) => {
    const pending = kickTimers.get(name);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      kickTimers.delete(name);
      action();
    }, options.kickDelayMs ?? KICK_DELAY_MS);
    timer.unref?.();
    kickTimers.set(name, timer);
  };

  const first = setTimeout(
    () => void run(false),
    options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS,
  );
  const timer = setInterval(
    () => void run(false),
    options.intervalMs ?? SYNC_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();

  const offConnection = onEvent("connectionChanged", ({ kind }) => {
    if (kind === KIND) kick("sync", () => void run(true));
  });
  const offLinks = onEvent("financeLinksPending", ({ ctx, connectionId }) => {
    if (!enabledConnection(ctx.db, connectionId)) return;
    linkRounds.add(connectionId);
    kick("links", () => void linkRound());
  });

  return () => {
    clearTimeout(first);
    clearInterval(timer);
    for (const t of kickTimers.values()) clearTimeout(t);
    offConnection();
    offLinks();
  };
}

function enabledConnection(db: ReturnType<typeof getDB>, id: string) {
  return listEnabledConnections({ db }, KIND).find((r) => r.id === id);
}
