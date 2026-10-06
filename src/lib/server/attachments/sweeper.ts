import { getDB } from "$lib/server/db";
import { sweepOrphanFiles } from "./attachments";

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

/**
 * Deletes stored files no attachment references (see `sweepOrphanFiles`) five minutes after
 * startup and then daily. Returns a stop function.
 */
export function startFileSweeper(
  options: { intervalMs?: number; firstRunDelayMs?: number } = {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await sweepOrphanFiles({ db: getDB(), now: Date.now() });
      if (result.files > 0 || result.temps > 0) {
        console.info(JSON.stringify({ event: "attachments.sweep", ...result }));
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "attachments.sweep_failed",
          name: err instanceof Error ? err.name : "NonError",
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
    options.intervalMs ?? SWEEP_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
