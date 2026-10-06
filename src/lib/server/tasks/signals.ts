import { haCalendarKey } from "$lib/tasks/engine";
import type {
  ExternalDates,
  Samples,
  Signals,
  Trigger,
} from "$lib/tasks/engine";

export interface SignalNeeds {
  /** Entity ids whose current state (and, for counters, history) the tasks look at. */
  entityIds: string[];
  /** Calendar subscriptions: `key` is what `externalDates` must be keyed by. */
  calendars: { key: string; entityId: string; summaryMatch?: string }[];
}

export interface SignalData {
  signals?: Signals;
  samples?: Samples;
  externalDates?: ExternalDates;
}

/**
 * Where live readings come from. The home-automation adapter registers one at
 * startup; without it every signal is missing and signal-based tasks report
 * `unknown`, which is the honest answer.
 */
export interface SignalProvider {
  load(needs: SignalNeeds, now: number): SignalData | Promise<SignalData>;
}

let provider: SignalProvider | null = null;

/** Install (or with null remove) the process-wide provider. */
export function setSignalProvider(next: SignalProvider | null): void {
  provider = next;
}

export function triggerSignalNeeds(triggers: readonly Trigger[]): SignalNeeds {
  const entityIds = new Set<string>();
  const calendars = new Map<string, SignalNeeds["calendars"][number]>();
  for (const trigger of triggers) {
    switch (trigger.type) {
      case "counter_delta":
        entityIds.add(trigger.entityId);
        break;
      case "state_condition":
        entityIds.add(trigger.entityId);
        if (trigger.estimateFrom) entityIds.add(trigger.estimateFrom.entityId);
        break;
      case "ha_calendar": {
        const key = haCalendarKey(trigger);
        calendars.set(key, {
          key,
          entityId: trigger.entityId,
          ...(trigger.summaryMatch === undefined
            ? {}
            : { summaryMatch: trigger.summaryMatch }),
        });
        break;
      }
      default:
        break;
    }
  }
  return {
    entityIds: [...entityIds].sort(),
    calendars: [...calendars.values()],
  };
}

export function isEmptyNeeds(needs: SignalNeeds): boolean {
  return needs.entityIds.length === 0 && needs.calendars.length === 0;
}

/** A failing provider must not take evaluation down: log the failure by name and carry on with no signals. */
export async function loadSignals(
  needs: SignalNeeds,
  now: number,
): Promise<Required<SignalData>> {
  const empty = { signals: {}, samples: {}, externalDates: {} };
  if (!provider || isEmptyNeeds(needs)) return empty;
  try {
    const data = await provider.load(needs, now);
    return {
      signals: data.signals ?? {},
      samples: data.samples ?? {},
      externalDates: data.externalDates ?? {},
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "signals.load_failed",
        name: err instanceof Error ? err.name : "NonError",
      }),
    );
    return empty;
  }
}
