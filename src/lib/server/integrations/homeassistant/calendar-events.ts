import { localDateOf, localTimeOf } from "$lib/dates";
import type {
  CalendarCapabilities,
  CalendarItem,
  RemoteEvent,
} from "$lib/server/calendar-sync/provider";
import { markerLine, parseMarker } from "$lib/server/calendar-sync/ref";
import {
  CALENDAR_FEATURE,
  type HaCalendarEvent,
  type HaCalendarEventWrite,
} from "./schemas";

/** Home Assistant refuses an event shorter than a second. */
const MIN_EVENT_MS = 1000;

/** `2026-06-20T08:00:00`: the wall-clock time at an instant in `timeZone`, without an offset. */
export function localDateTime(timeZone: string, instantMs: number): string {
  const seconds = Math.floor(instantMs / 1000) % 60;
  return `${localDateOf(timeZone, instantMs)}T${localTimeOf(timeZone, instantMs)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The text of the event: the item's lines, a link into the app when its address is known, and the
 * marker line that lets the event be found again. Notes and secrets never get here (the item has none).
 */
export function eventDescription(
  item: Pick<CalendarItem, "description" | "path" | "ref">,
  appUrl: string | null,
): string {
  const lines = [
    item.description.trim(),
    appUrl ? `${appUrl}${item.path}` : "",
  ].filter((line) => line !== "");
  return [
    ...(lines.length > 0 ? [lines.join("\n"), ""] : []),
    markerLine(item.ref),
  ].join("\n");
}

/**
 * The event as Home Assistant takes it. All-day items keep their dates (the end is exclusive here
 * as it is for the item); timed items become the wall-clock time in Home Assistant's own zone, which
 * is where it reads a time without an offset, and may differ from the household's.
 */
export function toHaEvent(
  item: CalendarItem,
  timeZone: string,
  appUrl: string | null,
): HaCalendarEventWrite {
  const common = {
    summary: item.summary,
    description: eventDescription(item, appUrl),
    location: item.location,
  };
  if (item.when.allDay) {
    return {
      ...common,
      start: { date: item.when.startDate },
      end: { date: item.when.endDate },
    };
  }
  const start = item.when.startsAt;
  const end = Math.max(item.when.endsAt, start + MIN_EVENT_MS);
  return {
    ...common,
    start: { dateTime: localDateTime(timeZone, start) },
    end: { dateTime: localDateTime(timeZone, end) },
  };
}

/** What the core needs of an event in the calendar: its id and our marker, if it has one. */
export function toRemoteEvent(event: HaCalendarEvent): RemoteEvent {
  return {
    uid: event.uid === null || event.uid === "" ? null : event.uid,
    ref: parseMarker(event.description),
  };
}

/** The bits of `supported_features` a calendar entity may have; anything but a whole number is none. */
export function featuresOf(attributes: Record<string, unknown>): number {
  const value = attributes.supported_features;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** Home Assistant keeps no reminders on its events, so `alarms` is never on. */
export function capabilitiesOf(features: number): CalendarCapabilities {
  return {
    create: (features & CALENDAR_FEATURE.create) !== 0,
    update: (features & CALENDAR_FEATURE.update) !== 0,
    delete: (features & CALENDAR_FEATURE.delete) !== 0,
    alarms: false,
  };
}
