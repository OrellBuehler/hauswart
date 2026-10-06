import { detectCounterReset, type AutoCompleteRule } from "$lib/tasks/engine";
import type { ServiceContext } from "$lib/server/service";
import { completeTask } from "$lib/server/tasks/completions";
import type { SignalChange, SignalValue } from "./service";
import { activeTriggers, autoCompleteRulesOf } from "./watch";

const same = (a: string | null, b: string): boolean =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a change of the rule's signal is the event the rule waits for. */
export function ruleMatches(
  rule: AutoCompleteRule,
  prev: SignalValue,
  next: SignalValue,
): boolean {
  if (rule.type === "counter_reset") {
    return (
      prev.numeric !== null &&
      next.numeric !== null &&
      detectCounterReset(prev.numeric, next.numeric, rule.minDrop)
    );
  }
  return (
    same(next.text, rule.to) &&
    !same(prev.text, rule.to) &&
    (rule.from === undefined || same(prev.text, rule.from))
  );
}

function logFailure(taskId: string, err: unknown): void {
  // Ids and error names only: titles are household data.
  console.error(
    JSON.stringify({
      event: "signals.auto_complete_failed",
      taskId,
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
}

/**
 * Completes the tasks whose auto-complete rules match a signal change (a
 * counter that dropped, a state that changed to the awaited value). The
 * completion is recorded by the system (source `ha`, no user) at the moment of
 * detection, with the counter's new value as its snapshot, for the occurrence
 * the task shows. The idempotency key names the task and the transition (the
 * signal and the moment it changed), so replaying the same change - after a
 * crash, or by calling this twice - completes nothing twice, while the next
 * real change completes again even though the occurrence moved on. The first sight
 * of a signal is no change: there is nothing to compare. Returns the ids of
 * the tasks completed.
 */
export async function applyAutoComplete(
  ctx: ServiceContext,
  changes: readonly SignalChange[],
): Promise<string[]> {
  const moved = changes.filter((c) => c.prev !== null);
  if (moved.length === 0) return [];
  const completed: string[] = [];
  for (const { taskId, trigger } of activeTriggers(ctx)) {
    const rules = autoCompleteRulesOf(trigger);
    for (const change of moved) {
      const prev = change.prev as SignalValue;
      const rule = rules.find(
        (r) => r.entityId === change.key && ruleMatches(r, prev, change.next),
      );
      if (!rule) continue;
      try {
        await completeTask(ctx, taskId, {
          kind: "done",
          source: "ha",
          userId: null,
          completedAt: ctx.now,
          idempotencyKey: `auto:${taskId}:${change.key}:${change.next.changedAt}`,
          ...(rule.type === "counter_reset" && change.next.numeric !== null
            ? { counterValue: change.next.numeric }
            : {}),
        });
        completed.push(taskId);
      } catch (err) {
        logFailure(taskId, err);
      }
      break;
    }
  }
  return completed;
}
