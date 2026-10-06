import { getDB } from "$lib/server/db";
import {
  pruneDeliveries,
  retryDeliveries,
} from "$lib/server/notifications/deliveries";
import type { ServiceContext } from "$lib/server/service";
import { processDueReactions } from "./reactions";
import { pruneSignals } from "./service";
import { watchedEntities } from "./watch";

export const SIGNAL_WORKER_INTERVAL_MS = 30_000;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 15_000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonError";
}

/** One pass: due hint reactions, held-back and failed deliveries. */
export async function runSignalWorker(ctx: ServiceContext): Promise<{
  reactions: number;
  delivered: number;
}> {
  const reactions = await processDueReactions(ctx);
  const deliveries = await retryDeliveries(ctx);
  return {
    reactions: reactions.sent,
    delivered: deliveries.sent + deliveries.retried,
  };
}

export interface SignalWorkerOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  clock?: () => number;
}

/**
 * Keeps the time-driven parts of signals going without any adapter: hint
 * reactions whose delay passed, notifications held back by quiet hours or that
 * failed, and the housekeeping of old samples and delivery records. Ticks never overlap, a failing
 * tick is logged and retried at the next, the timers do not keep the process
 * alive; the returned function stops them.
 */
export function registerSignalWorker(
  options: SignalWorkerOptions = {},
): () => void {
  const clock = options.clock ?? Date.now;
  let running = false;
  let lastPrune = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const ctx = { db: getDB(), now };
      await runSignalWorker(ctx);
      if (now - lastPrune >= PRUNE_EVERY_MS) {
        lastPrune = now;
        pruneSignals(
          ctx,
          watchedEntities(ctx).calendars.map((c) => c.key),
        );
        pruneDeliveries(ctx);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "signals.worker_failed",
          name: errorName(err),
        }),
      );
    } finally {
      running = false;
    }
  };
  const first = setTimeout(
    () => void tick(),
    options.firstRunDelayMs ?? FIRST_RUN_DELAY_MS,
  );
  const timer = setInterval(
    () => void tick(),
    options.intervalMs ?? SIGNAL_WORKER_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
