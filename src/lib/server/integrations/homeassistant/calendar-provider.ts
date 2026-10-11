import {
  ENTITY_ID_RE,
  type HaCalendarEventWrite,
  type HaState,
} from "./schemas";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import type {
  CalendarProvider,
  CalendarSession,
  RemoteCalendar,
} from "$lib/server/calendar-sync/provider";
import { retryTransient, type RetryOptions } from "../http";
import { appUrlOf } from "./app-url";
import {
  capabilitiesOf,
  featuresOf,
  toHaEvent,
  toRemoteEvent,
} from "./calendar-events";
import type { HomeAssistantClient } from "./client";
import { KIND, clientFor, toIntegrationError } from "./connection";
import { HomeAssistantError } from "./errors";

export interface CalendarProviderOptions {
  /** Per call to Home Assistant (default 10 s). */
  timeoutMs?: number;
  /** Retries of reads and of changes that set the same state again. */
  retry?: RetryOptions;
}

/** Calendars are asked for their state this many at a time. */
const PICKER_PARALLEL = 5;

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch (cause) {
    throw new HomeAssistantError("invalid_response", {
      detail: "unknown time zone",
      cause,
    });
  }
  return timeZone;
}

const nameOf = (state: HaState, fallback: string): string => {
  const friendly = state.attributes.friendly_name;
  return typeof friendly === "string" && friendly !== "" ? friendly : fallback;
};

function assertCalendarId(id: string): string {
  if (!ENTITY_ID_RE.test(id) || !id.startsWith("calendar.")) {
    throw toIntegrationError(new HomeAssistantError("not_found"));
  }
  return id;
}

/**
 * Home Assistant as a calendar system. The calendar is an entity of the `calendar` domain and
 * `supported_features` says what it takes (create 1, delete 2, update 4). Home Assistant has a service
 * for creating events only (`calendar.create_event`, which does not say the id the event got);
 * changing and deleting are WebSocket commands. Events are told apart by the marker in their
 * description (see `calendar-sync/ref.ts`), the only part of an event hauswart can count on. Times
 * are written as wall-clock time in Home Assistant's own zone (`/api/config`).
 */
export function createCalendarProvider(
  options: CalendarProviderOptions = {},
): CalendarProvider {
  const retry = <T>(fn: () => Promise<T>) => retryTransient(fn, options.retry);
  const client = (connection: ResolvedConnection) =>
    clientFor(connection, { timeoutMs: options.timeoutMs });

  /** Runs a call to Home Assistant and shows a failure the way the core expects it. */
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw toIntegrationError(err);
    }
  };

  async function stateOf(
    ha: HomeAssistantClient,
    id: string,
  ): Promise<HaState | null> {
    try {
      return await retry(() => ha.getState(id));
    } catch (err) {
      // A calendar in the list without a state has nothing it can be asked to do.
      if (err instanceof HomeAssistantError && err.code === "not_found") {
        return null;
      }
      throw err;
    }
  }

  return {
    kind: KIND,

    async listCalendars(connection) {
      const ha = client(connection);
      return run(async () => {
        const list = await retry(() => ha.listCalendars());
        const calendars: RemoteCalendar[] = [];
        for (let i = 0; i < list.length; i += PICKER_PARALLEL) {
          const chunk = list.slice(i, i + PICKER_PARALLEL);
          const states = await Promise.all(
            chunk.map((c) => stateOf(ha, c.entityId)),
          );
          chunk.forEach((c, n) => {
            const state = states[n];
            calendars.push({
              id: c.entityId,
              name: c.name,
              capabilities: capabilitiesOf(
                state ? featuresOf(state.attributes) : 0,
              ),
            });
          });
        }
        return calendars;
      });
    },

    async open(connection, calendarId): Promise<CalendarSession> {
      const id = assertCalendarId(calendarId);
      const ha = client(connection);
      const appUrl = appUrlOf(connection.config);
      const { state, timeZone } = await run(async () => {
        const [config, state] = await Promise.all([
          retry(() => ha.getConfig()),
          retry(() => ha.getState(id)),
        ]);
        return { state, timeZone: validZone(config.timeZone) };
      });
      const write = (
        item: Parameters<typeof toHaEvent>[0],
      ): HaCalendarEventWrite => toHaEvent(item, timeZone, appUrl);

      return {
        name: nameOf(state, id),
        capabilities: capabilitiesOf(featuresOf(state.attributes)),

        listEvents: (range) =>
          run(async () => {
            const events = await retry(() =>
              ha.getCalendarEvents(
                id,
                new Date(range.from),
                new Date(range.to),
              ),
            );
            return events.map(toRemoteEvent);
          }),

        // Not repeated after a timeout: the event may have been written, and a second one would be a duplicate.
        create: (item) =>
          run(async () => {
            await ha.createCalendarEvent(id, write(item));
            return { uid: null };
          }),

        update: (uid, item) =>
          run(() => retry(() => ha.updateCalendarEvent(id, uid, write(item)))),

        delete: (uid) => run(() => ha.deleteCalendarEvent(id, uid)),
      };
    },
  };
}
