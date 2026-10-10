import type { ServiceContext } from "$lib/server/service";
import { generateNotifications } from "$lib/server/notifications/generate";
import { evaluateTasks } from "$lib/server/tasks/evaluator";
import { applyAutoComplete } from "./auto-complete";
import { processDueReactions, scheduleReactions } from "./reactions";
import {
  upsertSignals,
  type SignalChange,
  type SignalReading,
} from "./service";
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

type Settled = Omit<IngestSummary, "changed" | "skipped">;

/**
 * What follows a change of stored readings, whoever stored them: completes the
 * tasks whose auto-complete rules match, schedules hint reactions, re-evaluates
 * the tasks that read a changed signal and announces what became due.
 */
export async function settleSignalChanges(
  ctx: ServiceContext,
  changes: readonly SignalChange[],
): Promise<Settled> {
  const settled: Settled = {
    autoCompleted: 0,
    reactionsScheduled: 0,
    reactionsFired: 0,
    evaluated: 0,
  };
  if (changes.length === 0) return settled;
  settled.autoCompleted = (await applyAutoComplete(ctx, changes)).length;
  settled.reactionsScheduled = scheduleReactions(ctx, changes);
  const affected = tasksReading(
    ctx,
    changes.map((c) => c.key),
  );
  settled.evaluated = (await evaluateTasks(ctx, affected)).evaluated;
  settled.reactionsFired = (await processDueReactions(ctx)).sent;
  await generateNotifications(ctx);
  return settled;
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
  return {
    changed: changes.length,
    skipped,
    ...(await settleSignalChanges(ctx, changes)),
  };
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
