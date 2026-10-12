import { getDB } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { bookDueRecurrences } from "./recurrences";

export const RECURRENCE_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 20_000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonError";
}

export interface RecurrenceSchedulerOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** What one tick does; replaced in tests. */
  run?: (ctx: ServiceContext) => Promise<unknown> | unknown;
  clock?: () => number;
}

/**
 * Books the recurring costs that fall due: shortly after startup (which catches up whatever fell due while the server was
 * down) and then every five minutes, so an occurrence is booked within minutes of the household's midnight. Booking is
 * idempotent per occurrence, ticks never overlap, a failing tick is logged by error name and tried again at the next one,
 * and the timers do not keep the process alive; the returned function stops them.
 */
export function registerCostRecurrences(
  options: RecurrenceSchedulerOptions = {},
): () => void {
  const run = options.run ?? ((ctx) => bookDueRecurrences(ctx));
  const clock = options.clock ?? Date.now;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await run({ db: getDB(), now: clock() });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "costs.recurrences_failed",
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
    options.intervalMs ?? RECURRENCE_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
