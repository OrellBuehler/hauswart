import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { leadValueSchema } from "$lib/api/schemas/tasks";
import { signalReactionSchema } from "$lib/api/schemas/hints";
import {
  triggerSchema,
  type AutoCompleteRule,
  type Trigger,
} from "$lib/tasks/engine";
import { emitEvent } from "$lib/server/events";
import { assetHints, assets, taskPreparations, tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import {
  triggerSignalNeeds,
  type SignalNeeds,
} from "$lib/server/tasks/signals";

/** Everything the household wants an adapter to keep reading. */
export type WatchList = SignalNeeds;

/** The auto-complete rules of a trigger, including the older `autoCompleteOnReset` shorthand of a counter. */
export function autoCompleteRulesOf(trigger: Trigger): AutoCompleteRule[] {
  const rules: AutoCompleteRule[] =
    "autoComplete" in trigger ? [...(trigger.autoComplete ?? [])] : [];
  if (trigger.type === "counter_delta" && trigger.autoCompleteOnReset) {
    rules.push({
      type: "counter_reset",
      entityId: trigger.entityId,
      minDrop: trigger.autoCompleteOnReset.minDrop,
    });
  }
  return rules;
}

function logSkipped(what: string, id: string, err: unknown): void {
  // Ids and error names only: titles and trigger contents are household data.
  console.error(
    JSON.stringify({
      event: "signals.watch_skipped",
      what,
      id,
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
}

/** The triggers of all active tasks; a stored trigger that no longer parses is logged and left out. */
export function activeTriggers(
  ctx: Pick<ServiceContext, "db">,
): { taskId: string; trigger: Trigger }[] {
  const out: { taskId: string; trigger: Trigger }[] = [];
  for (const row of ctx.db
    .select({ id: tasks.id, trigger: tasks.trigger })
    .from(tasks)
    .where(isNull(tasks.archivedAt))
    .all()) {
    const parsed = triggerSchema.safeParse(row.trigger);
    if (parsed.success) out.push({ taskId: row.id, trigger: parsed.data });
    else logSkipped("trigger", row.id, parsed.error);
  }
  return out;
}

/**
 * Entity ids and calendar subscriptions that active tasks (counter, state
 * and calendar triggers, their `estimateFrom` and auto-complete entities),
 * preparations with a signal lead and hint reactions refer to. This is the
 * list an adapter reads; nothing outside it is polled.
 */
export function watchedEntities(ctx: Pick<ServiceContext, "db">): WatchList {
  const triggers = activeTriggers(ctx);
  const needs = triggerSignalNeeds(triggers.map((t) => t.trigger));
  const entityIds = new Set(needs.entityIds);
  for (const { trigger } of triggers) {
    for (const rule of autoCompleteRulesOf(trigger)) {
      entityIds.add(rule.entityId);
    }
  }
  for (const row of ctx.db
    .select({ id: taskPreparations.id, leadValue: taskPreparations.leadValue })
    .from(taskPreparations)
    .innerJoin(tasks, eq(tasks.id, taskPreparations.taskId))
    .where(and(isNotNull(taskPreparations.leadValue), isNull(tasks.archivedAt)))
    .all()) {
    const parsed = leadValueSchema.safeParse(row.leadValue);
    if (parsed.success) entityIds.add(parsed.data.entityId);
    else logSkipped("preparation", row.id, parsed.error);
  }
  for (const row of ctx.db
    .select({ id: assetHints.id, reaction: assetHints.reaction })
    .from(assetHints)
    .innerJoin(assets, eq(assets.id, assetHints.assetId))
    .where(and(isNotNull(assetHints.reaction), isNull(assets.archivedAt)))
    .all()) {
    const parsed = signalReactionSchema.safeParse(row.reaction);
    if (parsed.success) entityIds.add(parsed.data.entityId);
    else logSkipped("hint", row.id, parsed.error);
  }
  return { entityIds: [...entityIds].sort(), calendars: needs.calendars };
}

/** Ids of the active tasks whose triggers read one of these entities or calendar keys. */
export function tasksReading(
  ctx: Pick<ServiceContext, "db">,
  entityIds: readonly string[],
  calendarKeys: readonly string[] = [],
): string[] {
  const entities = new Set(entityIds);
  const keys = new Set(calendarKeys);
  const ids: string[] = [];
  for (const { taskId, trigger } of activeTriggers(ctx)) {
    const needs = triggerSignalNeeds([trigger]);
    if (
      needs.entityIds.some((id) => entities.has(id)) ||
      needs.calendars.some((c) => keys.has(c.key))
    ) {
      ids.push(taskId);
    }
  }
  return ids;
}

/** Tells interested adapters that tasks, preparations or hint reactions changed what is watched. */
export function signalNeedsChanged(ctx: Pick<ServiceContext, "db">): void {
  emitEvent("signalNeedsChanged", { ctx });
}
