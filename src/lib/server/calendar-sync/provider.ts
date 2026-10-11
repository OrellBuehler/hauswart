import type { CalendarProviderKind } from "$lib/api/enums";
import type { CalendarTargetCapabilities } from "$lib/api/schemas/calendar-sync";
import type { ResolvedConnection } from "$lib/server/connections/registry";

export type CalendarCapabilities = CalendarTargetCapabilities;

/** A calendar of the connected system that a target can point at. */
export interface RemoteCalendar {
  /** The system's own id of it (an entity id, a collection address); opaque to the core. */
  id: string;
  name: string;
  capabilities: CalendarCapabilities;
}

/**
 * When something takes place, the same for every provider: a span of dates with an exclusive end
 * (a single day is `startDate` + 1 day), or two instants. Dates are calendar dates in the
 * household time zone; the provider turns them into whatever its calendar wants.
 */
export type ItemWhen =
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; startsAt: number; endsAt: number };

/** What the core wants to be in the calendar for one item. Never carries notes, comments or secrets. */
export interface CalendarItem {
  /** The item's stable name (`task-<id>-<occurrence>`): the event carries it so it can be found again. */
  ref: string;
  summary: string;
  /** Plain text, without the marker the provider adds. May be empty. */
  description: string;
  location: string | null;
  when: ItemWhen;
  /** Where the item lives in the app (`/tasks/<id>`); the provider may add the app's address to make a link. */
  path: string;
  /** Minutes before the start a reminder rings; null = none. Only calendars that keep reminders use it. */
  alarmMinutes: number | null;
}

/**
 * What a link remembers as the id of an event that exists but has none to remember (a calendar that
 * does not give ids): such an event cannot be changed or removed, only left as it is. `null` in a
 * link means something else: the event was written and not found again yet.
 */
export const NO_UID = "";

/** An event the calendar holds, as far as the core needs to know. */
export interface RemoteEvent {
  /** The calendar's own id of the event; null when it does not say (it cannot then be changed or removed). */
  uid: string | null;
  /** The name found on the event (see `ref.ts`); null for every event hauswart did not write. */
  ref: string | null;
}

/** The span of time a list of events is asked for, instants in ms since epoch. */
export interface TimeRange {
  from: number;
  to: number;
}

/**
 * A calendar opened for one run: the provider has resolved the connection, the calendar and what it
 * allows. Methods throw `IntegrationError` (a stable `code`, a message that is safe to show).
 */
export interface CalendarSession {
  /** The calendar's own name, for a target that was given none. */
  name: string;
  capabilities: CalendarCapabilities;
  /** Every event overlapping the range, ours and foreign ones alike; foreign ones come with `ref: null`. */
  listEvents(range: TimeRange): Promise<RemoteEvent[]>;
  /** Writes the event with the item's ref. `uid` is null when the calendar does not tell (it is found again by `ref`). */
  create(item: CalendarItem): Promise<{ uid: string | null }>;
  update(uid: string, item: CalendarItem): Promise<void>;
  delete(uid: string): Promise<void>;
}

/**
 * What a system with calendars offers the core. Registered at startup by an adapter under the name
 * in `CALENDAR_PROVIDERS`; the core knows nothing else about it. A calendar system that keeps our
 * name in another place than the description (a UID, a property) only has to return it as `ref`.
 */
export interface CalendarProvider {
  kind: CalendarProviderKind;
  listCalendars(connection: ResolvedConnection): Promise<RemoteCalendar[]>;
  /** Throws `IntegrationError("not_found")` when the calendar no longer exists. */
  open(
    connection: ResolvedConnection,
    calendarId: string,
  ): Promise<CalendarSession>;
}

const providers = new Map<CalendarProviderKind, CalendarProvider>();

/** Adds (or replaces) the provider of a kind; returns a function that removes it. */
export function registerCalendarProvider(
  provider: CalendarProvider,
): () => void {
  providers.set(provider.kind, provider);
  return () => {
    if (providers.get(provider.kind) === provider) {
      providers.delete(provider.kind);
    }
  };
}

export function getCalendarProvider(
  kind: CalendarProviderKind,
): CalendarProvider | undefined {
  return providers.get(kind);
}
