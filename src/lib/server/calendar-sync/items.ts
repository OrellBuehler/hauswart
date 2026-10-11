import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CalendarItemKind } from "$lib/api/enums";
import type { CalendarTargetConfig } from "$lib/api/schemas/calendar-sync";
import { addDays, zonedTimeToInstant } from "$lib/dates";
import {
  readCalendarEntries,
  type CalendarEntry,
} from "$lib/server/calendar/entries";
import { householdTimeZone } from "$lib/server/config";
import { connections } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import {
  getCalendarProvider,
  type CalendarItem,
  type ItemWhen,
  type TimeRange,
} from "./provider";
import { configOf, type TargetRow } from "./store";

/** Calendar sync looks this far back (days before today) ... */
export const HORIZON_PAST_DAYS = 31;
/** ... and this far ahead; what lies beyond is not written yet and comes into view as time passes. */
export const HORIZON_FUTURE_DAYS = 400;
/** Events are read a little wider than the horizon, so a written one is found wherever the zone put it. */
const READ_MARGIN_DAYS = 2;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** An item to be in the calendar, with the name of its source and a fingerprint of everything that is written. */
export interface DesiredItem extends CalendarItem {
  kind: CalendarItemKind;
  itemId: string;
  instanceKey: string;
  /** Changes whenever anything the calendar shows (or keeps) changes. */
  hash: string;
}

/** The part of a target's settings the builder needs. */
export interface ItemSettings {
  config: CalendarTargetConfig;
  /** Whose `mine` it is; null for household targets, which see everything. */
  userId: string | null;
  /**
   * Whether the calendar keeps reminders (`capabilities.alarms`). Without, items carry none, so a
   * reminder the target asks for changes nothing that is written. Default: it does.
   */
  alarms?: boolean;
  /** What the provider adds to an item (`CalendarProvider.fingerprint`); part of every item's hash. */
  fingerprint?: string;
}

/**
 * The settings of a stored target: its config, whether its calendar kept reminders when it was last
 * opened, and what its provider adds. Throws when the stored config is invalid. A run opens the
 * calendar first and passes what it found instead.
 */
export function itemSettingsOf(
  ctx: Pick<ServiceContext, "db">,
  row: TargetRow,
  alarms: boolean = row.capabilitiesJson?.alarms ?? false,
): ItemSettings {
  const connection = ctx.db
    .select({ configJson: connections.configJson })
    .from(connections)
    .where(eq(connections.id, row.connectionId))
    .get();
  return {
    config: configOf(row),
    userId: row.userId,
    alarms,
    fingerprint:
      getCalendarProvider(row.provider)?.fingerprint?.(
        connection?.configJson ?? {},
      ) ?? "",
  };
}

/** The first instant of a date in the household zone. */
const startOfDay = (date: string, tz: string) =>
  zonedTimeToInstant(date, "00:00", tz);

/** Instants that bound what is written: from the first day to the first instant after the last. */
export function horizon(now: number, tz = householdTimeZone()): TimeRange {
  const { today } = clockAt(now);
  return {
    from: startOfDay(addDays(today, -HORIZON_PAST_DAYS), tz),
    to: startOfDay(addDays(today, HORIZON_FUTURE_DAYS + 1), tz),
  };
}

/** The range events are read for: the horizon plus a margin on both sides. */
export function readRange(now: number, tz = householdTimeZone()): TimeRange {
  const { from, to } = horizon(now, tz);
  return {
    from: from - READ_MARGIN_DAYS * DAY_MS,
    to: to + READ_MARGIN_DAYS * DAY_MS,
  };
}

/** The first instant of an item and the first instant after it. */
export function bounds(when: ItemWhen, tz: string): TimeRange {
  return when.allDay
    ? { from: startOfDay(when.startDate, tz), to: startOfDay(when.endDate, tz) }
    : { from: when.startsAt, to: when.endsAt };
}

function whenOf(
  entry: CalendarEntry,
  settings: ItemSettings["config"],
  tz: string,
): ItemWhen {
  const date = entry.date;
  if (typeof date !== "string") {
    if ("startsAt" in date) {
      return { allDay: false, startsAt: date.startsAt, endsAt: date.endsAt };
    }
    return { allDay: true, startDate: date.start, endDate: date.end };
  }
  if (settings.timedMode === "timed") {
    const startsAt = zonedTimeToInstant(date, settings.dueTime, tz);
    return {
      allDay: false,
      startsAt,
      endsAt: startsAt + settings.dueDurationMinutes * MINUTE_MS,
    };
  }
  return { allDay: true, startDate: date, endDate: addDays(date, 1) };
}

/**
 * A fingerprint of what is written for an item; equal fingerprints mean there is nothing to push.
 * `fingerprint` is what the provider adds on top of the item.
 */
export function itemHash(item: CalendarItem, fingerprint = ""): string {
  const canonical = JSON.stringify([
    item.ref,
    item.summary,
    item.description,
    item.location,
    item.when.allDay
      ? ["d", item.when.startDate, item.when.endDate]
      : ["t", item.when.startsAt, item.when.endsAt],
    item.path,
    item.alarmMinutes,
    fingerprint,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * What a target wants in its calendar right now: the entries of the kinds it carries
 * (`readCalendarEntries`, the same reading the iCal feed uses), inside the horizon, with the
 * target's prefix, timing and reminder. Nothing but titles, places and dates: the entries carry no
 * notes, task descriptions or secrets, so neither can reach a calendar. Sorted by start, then name.
 */
export async function buildDesiredItems(
  ctx: ServiceContext,
  settings: ItemSettings,
): Promise<DesiredItem[]> {
  const { config } = settings;
  const tz = householdTimeZone();
  const kinds = new Set<CalendarItemKind>(config.kinds);
  const limits = horizon(ctx.now, tz);
  const entries = await readCalendarEntries(ctx, {
    locale: config.locale,
    scope: settings.userId === null ? "all" : config.scope,
    userId: settings.userId,
    includeEstimated: false,
    tasks: kinds.has("task_due"),
    preparations: kinds.has("preparations"),
    defects: kinds.has("defect_deadlines"),
    warranties: kinds.has("warranty_ends"),
    appointments: kinds.has("appointments"),
    insurance: kinds.has("insurance_deadlines"),
    // A defect's or policy's own entry stands for its reminder task, when that entry is carried.
    skipTaskSources: [
      ...(kinds.has("defect_deadlines") ? ["defect"] : []),
      ...(kinds.has("insurance_deadlines") ? ["insurance"] : []),
    ],
  });

  const items = new Map<string, { item: DesiredItem; start: number }>();
  for (const entry of entries) {
    if (!kinds.has(entry.kind) || items.has(entry.uid)) continue;
    const when = whenOf(entry, config, tz);
    const span = bounds(when, tz);
    if (span.to <= limits.from || span.from >= limits.to) continue;
    const base: CalendarItem = {
      ref: entry.uid,
      summary: `${config.titlePrefix}${entry.summary}`,
      description: entry.description,
      location: entry.location ?? null,
      when,
      path: entry.path,
      alarmMinutes:
        settings.alarms !== false && entry.alarmable
          ? config.alarmMinutes
          : null,
    };
    items.set(entry.uid, {
      item: {
        ...base,
        kind: entry.kind,
        itemId: entry.itemId,
        instanceKey: entry.instance,
        hash: itemHash(base, settings.fingerprint),
      },
      start: span.from,
    });
  }
  return [...items.values()]
    .sort(
      (a, b) =>
        a.start - b.start ||
        (a.item.ref < b.item.ref ? -1 : a.item.ref > b.item.ref ? 1 : 0),
    )
    .map((entry) => entry.item);
}
