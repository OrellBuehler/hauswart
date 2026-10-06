import { and, gte, inArray } from "drizzle-orm";
import { haCalendarKey } from "$lib/tasks/engine";
import { externalDates, signalSamples, signals, type DB } from "$lib/server/db";
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
 * Where live readings come from. By default the tables the adapters fill
 * (`signals`, `signal_samples`, `external_dates`, see `signals/service.ts`);
 * without readings every signal is missing and signal-based tasks report
 * `unknown`, which is the honest answer. A provider replaces the tables
 * (tests, or an adapter that wants to answer live).
 */
export interface SignalProvider {
  load(needs: SignalNeeds, now: number): SignalData | Promise<SignalData>;
}

let provider: SignalProvider | null = null;

/** Install (or with null restore the table-backed default) the process-wide provider. */
export function setSignalProvider(next: SignalProvider | null): void {
  provider = next;
}

const SAMPLE_WINDOW_MS = 100 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_KEY = 2000;
const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK));
  }
  return out;
}

/** The stored readings the tasks in `needs` look at. */
export function loadSignalsFromDb(
  db: DB,
  needs: SignalNeeds,
  now: number,
): Required<SignalData> {
  const result: Required<SignalData> = {
    signals: {},
    samples: {},
    externalDates: {},
  };
  for (const ids of chunks(needs.entityIds)) {
    for (const row of db
      .select()
      .from(signals)
      .where(inArray(signals.key, ids))
      .all()) {
      result.signals[row.key] = {
        numeric: row.numeric,
        text: row.text,
        changedAt: row.changedAt.getTime(),
        seenAt: row.seenAt.getTime(),
      };
    }
    for (const row of db
      .select()
      .from(signalSamples)
      .where(
        and(
          inArray(signalSamples.key, ids),
          gte(signalSamples.at, new Date(now - SAMPLE_WINDOW_MS)),
        ),
      )
      .orderBy(signalSamples.key, signalSamples.at)
      .all()) {
      (result.samples[row.key] ??= []).push({
        at: row.at.getTime(),
        value: row.value,
      });
    }
  }
  for (const list of Object.values(result.samples)) {
    if (list.length > MAX_SAMPLES_PER_KEY) {
      list.splice(0, list.length - MAX_SAMPLES_PER_KEY);
    }
  }
  const keys = needs.calendars.map((c) => c.key);
  for (const part of chunks(keys)) {
    for (const row of db
      .select()
      .from(externalDates)
      .where(inArray(externalDates.key, part))
      .orderBy(externalDates.date)
      .all()) {
      const list = (result.externalDates[row.key] ??= []);
      if (!list.includes(row.date)) list.push(row.date);
    }
  }
  return result;
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
  db: DB,
  needs: SignalNeeds,
  now: number,
): Promise<Required<SignalData>> {
  const empty = { signals: {}, samples: {}, externalDates: {} };
  if (isEmptyNeeds(needs)) return empty;
  try {
    const data = provider
      ? await provider.load(needs, now)
      : loadSignalsFromDb(db, needs, now);
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
