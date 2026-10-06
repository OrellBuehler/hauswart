import type { ServiceContext } from "$lib/server/service";
import { generateNotifications } from "$lib/server/notifications/generate";
import { evaluateTasks } from "$lib/server/tasks/evaluator";
import { applyAutoComplete } from "./auto-complete";
import { processDueReactions, scheduleReactions } from "./reactions";
import { upsertSignals, type SignalReading } from "./service";
import { tasksReading } from "./watch";

export interface IngestSummary {
  /** Readings whose value differs from the stored one (or are new). */
  changed: number;
  /** Readings without a value; the last known one stays. */
  skipped: number;
  autoCompleted: number;
  reactionsScheduled: number;
  reactionsFired: number;
  evaluated: number;
}

/**
 * What an adapter calls with the readings it fetched: stores them (and the
 * numeric history), completes tasks whose auto-complete rules match, schedules
 * hint reactions, re-evaluates the tasks that read a changed signal and
 * announces what became due. Adapters know nothing of tasks, hints or
 * notifications; this is the only entry point they need.
 */
export async function ingestSignals(
  ctx: ServiceContext,
  readings: readonly SignalReading[],
  source: string,
): Promise<IngestSummary> {
  const { changes, skipped } = upsertSignals(ctx, readings, source);
  const summary: IngestSummary = {
    changed: changes.length,
    skipped,
    autoCompleted: 0,
    reactionsScheduled: 0,
    reactionsFired: 0,
    evaluated: 0,
  };
  if (changes.length === 0) return summary;
  summary.autoCompleted = (await applyAutoComplete(ctx, changes)).length;
  summary.reactionsScheduled = scheduleReactions(ctx, changes);
  const affected = tasksReading(
    ctx,
    changes.map((c) => c.key),
  );
  summary.evaluated = (await evaluateTasks(ctx, affected)).evaluated;
  summary.reactionsFired = (await processDueReactions(ctx)).sent;
  await generateNotifications(ctx);
  return summary;
}

/** New calendar dates arrived for these subscription keys: re-evaluate the tasks that use them and announce what became due. */
export async function afterCalendarSync(
  ctx: ServiceContext,
  keys: readonly string[],
): Promise<number> {
  if (keys.length === 0) return 0;
  const { evaluated } = await evaluateTasks(ctx, tasksReading(ctx, [], keys));
  await generateNotifications(ctx);
  return evaluated;
}
