import { getDB } from "$lib/server/db";
import { pruneFinishedUploads } from "$lib/server/documents/uploads";
import { onEvent } from "$lib/server/events";
import { KIND } from "./connection";
import { clearTaxonomyCache } from "./mapping";
import { syncAll } from "./sync";

export const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30_000;
const KICK_DELAY_MS = 1_500;

export interface SchedulerOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** Wait this long after a change before reading, so a burst of edits causes one read. */
  kickDelayMs?: number;
  clock?: () => number;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonError";
}

/**
 * Keeps every person's document cache current: a read of all enabled connections every 30
 * minutes, and soon after a connection is saved (immediately, backoff ignored) or something is
 * linked (so other people's accounts catch up with a document they may see too). Runs never
 * overlap (a request during a run is run once more afterwards), a failing run is logged and tried
 * again at the next tick, failures per connection back off in `syncConnection`, the timers do
 * not keep the process alive; the returned function stops everything.
 */
export function startPaperlessScheduler(
  options: SchedulerOptions = {},
): (() => void) & { idle(): Promise<void> } {
  const clock = options.clock ?? Date.now;
  let running = false;
  let again: { force: boolean } | null = null;
  let active: Promise<void> = Promise.resolve();

  const run = (ignoreBackoff: boolean): void => {
    if (running) {
      again = { force: again?.force || ignoreBackoff };
      return;
    }
    running = true;
    active = (async () => {
      try {
        const ctx = { db: getDB(), now: clock() };
        await syncAll(ctx, { ignoreBackoff });
        pruneFinishedUploads(ctx);
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "paperless.scheduler_failed",
            name: errorName(err),
          }),
        );
      } finally {
        running = false;
        const next = again;
        again = null;
        if (next) run(next.force);
      }
    })();
  };

  let kickTimer: ReturnType<typeof setTimeout> | null = null;
  let kickForce = false;
  const kick = (ignoreBackoff: boolean) => {
    kickForce = kickForce || ignoreBackoff;
    if (kickTimer) clearTimeout(kickTimer);
    kickTimer = setTimeout(() => {
      kickTimer = null;
      const force = kickForce;
      kickForce = false;
      run(force);
    }, options.kickDelayMs ?? KICK_DELAY_MS);
    kickTimer.unref?.();
  };

  const first = setTimeout(
    () => run(false),
    options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS,
  );
  const timer = setInterval(
    () => run(false),
    options.intervalMs ?? SYNC_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();

  const offConnection = onEvent("connectionChanged", ({ kind }) => {
    if (kind !== KIND) return;
    clearTaxonomyCache();
    kick(true);
  });
  const offLinks = onEvent("documentLinksChanged", () => kick(false));

  const stop = () => {
    clearTimeout(first);
    clearInterval(timer);
    if (kickTimer) clearTimeout(kickTimer);
    offConnection();
    offLinks();
  };
  /** Resolves when no run is going on (and none is queued behind it): for tests and shutdown. */
  const idle = async (): Promise<void> => {
    let seen: Promise<void>;
    do {
      seen = active;
      await seen;
    } while (seen !== active);
  };
  return Object.assign(stop, { idle });
}
