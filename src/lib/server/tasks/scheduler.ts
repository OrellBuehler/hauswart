import { getDB } from "$lib/server/db";
import { generateNotifications } from "$lib/server/notifications/generate";
import type { ServiceContext } from "$lib/server/service";
import { evaluateAll } from "./evaluator";

export const EVALUATION_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10_000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "NonError";
}

/** One pass: refresh every task's due state, then announce what changed. */
export async function runEvaluationCycle(ctx: ServiceContext): Promise<{
  evaluated: number;
  failed: number;
  notifications: number;
}> {
  const summary = await evaluateAll(ctx);
  const { created } = await generateNotifications(ctx);
  return { ...summary, notifications: created };
}

export interface EvaluatorOptions {
  intervalMs?: number;
  firstRunDelayMs?: number;
  /** What one tick does; replaced in tests. */
  run?: (ctx: ServiceContext) => Promise<unknown>;
  clock?: () => number;
}

/**
 * Keeps due states and notifications fresh: runs shortly after startup and
 * then every five minutes (completions and edits re-evaluate on their own).
 * Ticks never overlap and a failing tick is logged and retried at the next
 * one. The timers do not keep the process alive; the returned function stops
 * them.
 */
export function registerEvaluator(options: EvaluatorOptions = {}): () => void {
  const run = options.run ?? runEvaluationCycle;
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
          event: "tasks.evaluator_failed",
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
    options.intervalMs ?? EVALUATION_INTERVAL_MS,
  );
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
