import { householdTimeZone } from "$lib/server/config";
import {
  dueForAttempt,
  recordConnectionFailure,
  recordConnectionOk,
  resolveConnection,
} from "$lib/server/connections/connections";
import { ingestSignals, afterCalendarSync } from "$lib/server/signals/ingest";
import {
  hasExternalDates,
  replaceExternalDates,
  type ExternalDateEntry,
  type SignalReading,
} from "$lib/server/signals/service";
import { watchedEntities } from "$lib/server/signals/watch";
import type { ServiceContext } from "$lib/server/service";
import { clientFor, householdConnection, SIGNAL_SOURCE } from "./connection";
import { errorCode } from "./errors";
import {
  HaInputError,
  calendarEventsToDates,
  compileSummaryMatcher,
  toSignal,
} from "./helpers";
import { ENTITY_ID_RE } from "./schemas";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead calendar events are read. */
export const CALENDAR_HORIZON_DAYS = 60;
/** With nothing to read, the connection is still checked this often so its status stays true. */
const IDLE_CHECK_MS = 10 * 60 * 1000;

export type PollResult =
  | { status: "no_connection" }
  | { status: "backoff" }
  | { status: "idle" }
  | { status: "failed"; code: string; failures: number }
  | {
      status: "ok";
      read: number;
      missing: number;
      changed: number;
      autoCompleted: number;
    };

let loggedMissing = "";

function logFailure(event: string, err: unknown): void {
  // The error's short code only: messages can carry addresses, bodies never reach them.
  console.error(JSON.stringify({ event, code: errorCode(err) }));
}

/**
 * Reads the state of every watched entity once and hands the readings to the
 * core (`ingestSignals`). Skips while the connection is backing off after
 * failures (1, 2, 4 ... 15 minutes), unless `ignoreBackoff`. The outcome is
 * recorded on the connection: status, last error code, failures in a row.
 * An entity Home Assistant does not know is counted as `missing` and never
 * stops the others; ids that are not entity ids are not requested.
 */
export async function pollStates(
  ctx: ServiceContext,
  options: { ignoreBackoff?: boolean } = {},
): Promise<PollResult> {
  const row = householdConnection(ctx.db);
  if (!row) return { status: "no_connection" };
  if (!options.ignoreBackoff && !dueForAttempt(row, ctx.now)) {
    return { status: "backoff" };
  }
  const watched = watchedEntities(ctx).entityIds.filter((id) =>
    ENTITY_ID_RE.test(id),
  );
  const client = clientFor(resolveConnection(row));

  if (watched.length === 0) {
    const checkedAgo = row.lastCheckedAt
      ? ctx.now - row.lastCheckedAt.getTime()
      : Infinity;
    if (row.status === "ok" && checkedAgo < IDLE_CHECK_MS) {
      return { status: "idle" };
    }
    try {
      await client.getConfig();
      recordConnectionOk(ctx, row.id);
      return { status: "idle" };
    } catch (err) {
      logFailure("homeassistant.poll_failed", err);
      const code = errorCode(err);
      return {
        status: "failed",
        code,
        failures: recordConnectionFailure(ctx, row, code),
      };
    }
  }

  let fetched;
  try {
    fetched = await client.getEntitiesStates(watched);
  } catch (err) {
    logFailure("homeassistant.poll_failed", err);
    const code = errorCode(err);
    return {
      status: "failed",
      code,
      failures: recordConnectionFailure(ctx, row, code),
    };
  }
  recordConnectionOk(ctx, row.id);

  const readings: SignalReading[] = [...fetched.states.values()].map(
    (state) => {
      const signal = toSignal(state, ctx.now);
      const unit = state.attributes.unit_of_measurement;
      return {
        key: state.entityId,
        numeric: signal.numeric,
        text: signal.text,
        unit: typeof unit === "string" && unit !== "" ? unit : null,
        changedAt: signal.changedAt ?? ctx.now,
      };
    },
  );
  const signature = fetched.missing.join(",");
  if (signature !== loggedMissing) {
    loggedMissing = signature;
    if (fetched.missing.length > 0) {
      console.warn(
        JSON.stringify({
          event: "homeassistant.entities_missing",
          count: fetched.missing.length,
        }),
      );
    }
  }
  let summary = { changed: 0, autoCompleted: 0 };
  try {
    summary = await ingestSignals(ctx, readings, SIGNAL_SOURCE);
  } catch (err) {
    // A core failure, not the connection's: logged by name, the next poll tries again.
    console.error(
      JSON.stringify({
        event: "homeassistant.ingest_failed",
        name: err instanceof Error ? err.name : "NonError",
      }),
    );
  }
  return {
    status: "ok",
    read: readings.length,
    missing: fetched.missing.length,
    changed: summary.changed,
    autoCompleted: summary.autoCompleted,
  };
}

export interface CalendarSyncResult {
  synced: number;
  failed: number;
  changedKeys: string[];
}

function entriesOf(
  events: Awaited<
    ReturnType<ReturnType<typeof clientFor>["getCalendarEvents"]>
  >,
  tz: string,
  summaryMatch: string | undefined,
): ExternalDateEntry[] {
  const titles = new Map<string, string>();
  const matches = compileSummaryMatcher(summaryMatch);
  for (const event of events) {
    if (!matches(event.summary)) continue;
    for (const date of calendarEventsToDates([event], tz)) {
      if (!titles.has(date)) titles.set(date, event.summary);
    }
  }
  return calendarEventsToDates(events, tz, summaryMatch).map((date) => ({
    date,
    title: titles.get(date) ?? "",
  }));
}

/**
 * Reads the next 60 days of every watched calendar subscription and replaces
 * its stored dates (dates of an event whose summary matches the task's
 * filter, in the household time zone). A calendar that fails keeps its old
 * dates; one that is not a calendar entity or whose filter is not allowed is
 * skipped and logged. With `onlyMissing`, subscriptions that already have
 * dates and were read less than `maxAgeMs` ago are left alone.
 */
export async function syncCalendars(
  ctx: ServiceContext,
  options: {
    lastSynced?: Map<string, number>;
    maxAgeMs?: number;
    ignoreBackoff?: boolean;
  } = {},
): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { synced: 0, failed: 0, changedKeys: [] };
  const row = householdConnection(ctx.db);
  if (!row) return result;
  if (!options.ignoreBackoff && !dueForAttempt(row, ctx.now)) return result;
  const { calendars } = watchedEntities(ctx);
  if (calendars.length === 0) return result;
  const client = clientFor(resolveConnection(row));
  const tz = householdTimeZone();
  const from = new Date(ctx.now - DAY_MS);
  const to = new Date(ctx.now + CALENDAR_HORIZON_DAYS * DAY_MS);
  for (const calendar of calendars) {
    const last = options.lastSynced?.get(calendar.key);
    if (
      options.maxAgeMs !== undefined &&
      last !== undefined &&
      ctx.now - last < options.maxAgeMs &&
      hasExternalDates(ctx, calendar.key)
    ) {
      continue;
    }
    try {
      if (
        !calendar.entityId.startsWith("calendar.") ||
        !ENTITY_ID_RE.test(calendar.entityId)
      ) {
        throw new HaInputError("not a calendar entity");
      }
      const events = await client.getCalendarEvents(
        calendar.entityId,
        from,
        to,
      );
      const entries = entriesOf(events, tz, calendar.summaryMatch);
      if (replaceExternalDates(ctx, calendar.key, entries)) {
        result.changedKeys.push(calendar.key);
      }
      options.lastSynced?.set(calendar.key, ctx.now);
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      console.error(
        JSON.stringify({
          event: "homeassistant.calendar_failed",
          code: errorCode(err),
        }),
      );
    }
  }
  if (result.changedKeys.length > 0) {
    await afterCalendarSync(ctx, result.changedKeys);
  }
  return result;
}
