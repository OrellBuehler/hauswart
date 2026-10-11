import { localDateOf, localTimeOf } from "$lib/dates";
import { householdTimeZone } from "$lib/server/config";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { readCalendarEntries, type CalendarEntry } from "./entries";
import { buildIcs, etagFor, type IcsAlarm, type IcsEvent } from "./ical";
import type { FeedRow } from "./feeds";

export {
  APPOINTMENT_LOOKBACK_DAYS,
  ESTIMATE_HORIZON_DAYS,
  WARRANTY_HORIZON_DAYS,
} from "./entries";

const SEQUENCE_EPOCH = Date.UTC(2025, 0, 1);

const sequenceOf = (lastModified: number) =>
  Math.max(0, Math.floor((lastModified - SEQUENCE_EPOCH) / 60_000));

export interface BuiltFeed {
  ics: string;
  etag: string;
}

/**
 * The feed's calendar: the entries its scope covers (`readCalendarEntries`), as events. Only
 * titles, places and dates go in: never notes, descriptions, comments or anything from a secret
 * block. UIDs, DTSTAMP and SEQUENCE derive from stored data (not from the request time), so the
 * output, and with it the ETag, only changes when the content does.
 */
export async function buildFeedCalendar(
  ctx: ServiceContext,
  feed: FeedRow,
  origin: string,
): Promise<BuiltFeed> {
  const tz = householdTimeZone();
  const household = getHousehold(ctx);
  const alarm: IcsAlarm | undefined = feed.alarmTime
    ? { time: feed.alarmTime, tz, daysBefore: feed.alarmDaysBefore }
    : undefined;

  const entries = await readCalendarEntries(ctx, {
    locale: feed.locale,
    scope: feed.scope,
    userId: feed.userId,
    includeEstimated: feed.includeEstimated,
    tasks: true,
    preparations: feed.includePreparations,
    defects: feed.includeDefects,
    warranties: feed.includeWarranties,
    appointments: true,
    insurance: false,
    // A defect's reminder task is the defect's deadline: the defect event stands for it.
    skipTaskSources: ["defect"],
  });

  const events: IcsEvent[] = entries.map((e: CalendarEntry) => ({
    uid: `${e.uid}@hauswart`,
    date: e.date,
    summary: e.summary,
    description: e.description,
    ...(e.location ? { location: e.location } : {}),
    url: `${origin}${e.path}`,
    ...(e.busy === undefined ? {} : { busy: e.busy }),
    ...(e.status ? { status: e.status } : {}),
    sequence: sequenceOf(e.lastModified),
    lastModified: e.lastModified,
    ...(e.categories ? { categories: e.categories } : {}),
    ...(alarm && e.alarmable ? { alarm } : {}),
  }));

  const sortKey = (e: IcsEvent) =>
    typeof e.date === "string"
      ? e.date
      : "start" in e.date
        ? e.date.start
        : `${localDateOf(tz, e.date.startsAt)}T${localTimeOf(tz, e.date.startsAt)}`;
  events.sort(
    (a, b) =>
      sortKey(a).localeCompare(sortKey(b)) || a.uid.localeCompare(b.uid),
  );

  const newest = events.reduce(
    (max, e) => Math.max(max, e.lastModified ?? 0),
    feed.updatedAt.getTime(),
  );
  const ics = buildIcs({
    calendarName: `${household.name}: ${feed.name}`,
    events,
    prodId: `-//hauswart//calendar feed//${feed.locale.toUpperCase()}`,
    now: Math.max(newest, feed.updatedAt.getTime()),
  });
  return { ics, etag: etagFor(ics) };
}
