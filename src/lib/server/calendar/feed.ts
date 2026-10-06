import { and, eq, isNotNull, isNull, ne, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { TaskCategory, UserLocale } from "$lib/api/enums";
import { addDays, diffDays, maxDate } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import { householdTimeZone } from "$lib/server/config";
import { assets, defects, rooms, taskState, tasks } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { preparationsForTasks } from "$lib/server/tasks/preparations";
import {
  stateToDue,
  toStateRecord,
  type TaskStateRecord,
} from "$lib/server/tasks/state";
import { buildIcs, etagFor, type IcsAlarm, type IcsEvent } from "./ical";
import type { FeedRow } from "./feeds";

export const ESTIMATE_HORIZON_DAYS = 45;
export const WARRANTY_HORIZON_DAYS = 365;
const SEQUENCE_EPOCH = Date.UTC(2025, 0, 1);

type Opts = { locale: UserLocale };

const CATEGORY: Record<TaskCategory, (i: object, o: Opts) => string> = {
  cleaning: m.category_cleaning,
  maintenance: m.category_maintenance,
  filter: m.category_filter,
  plant: m.category_plant,
  waste: m.category_waste,
  inspection: m.category_inspection,
  payment: m.category_payment,
  order: m.category_order,
  warranty: m.category_warranty,
  defect: m.category_defect,
  other: m.category_other,
};

const sequenceOf = (lastModified: number) =>
  Math.max(0, Math.floor((lastModified - SEQUENCE_EPOCH) / 60_000));

const uidPart = (value: string) => value.replace(/[^A-Za-z0-9:._-]/g, "_");

export interface BuiltFeed {
  ics: string;
  etag: string;
}

interface Dated {
  date: string;
  estimated: boolean;
}

/**
 * Where a task shows up: its due date, or (when the feed wants them) a medium-confidence estimate
 * within the next 45 days. Tasks without either, and estimates the feed does not want, are not
 * in the calendar.
 */
function datedOf(
  state: TaskStateRecord,
  feed: Pick<FeedRow, "includeEstimated">,
  today: string,
): Dated | null {
  if (state.dueDate) return { date: state.dueDate, estimated: false };
  const estimate = state.estimate;
  if (
    feed.includeEstimated &&
    estimate &&
    estimate.confidence === "medium" &&
    estimate.date >= today &&
    diffDays(estimate.date, today) <= ESTIMATE_HORIZON_DAYS
  ) {
    return { date: estimate.date, estimated: true };
  }
  return null;
}

/**
 * The feed's calendar: the next occurrence of every active task the feed's scope covers, plus
 * (as the feed asks) preparations, defect deadlines and warranty ends. Only titles, places and
 * dates go in: never notes, descriptions, comments or anything from a secret block. UIDs, DTSTAMP
 * and SEQUENCE derive from stored data (not from the request time), so the output, and with it the
 * ETag, only changes when the content does.
 */
export async function buildFeedCalendar(
  ctx: ServiceContext,
  feed: FeedRow,
  origin: string,
): Promise<BuiltFeed> {
  const { today } = clockAt(ctx.now);
  const tz = householdTimeZone();
  const o: Opts = { locale: feed.locale };
  const household = getHousehold(ctx);
  const alarm: IcsAlarm | undefined = feed.alarmTime
    ? { time: feed.alarmTime, tz, daysBefore: feed.alarmDaysBefore }
    : undefined;
  const events: IcsEvent[] = [];

  const assetRoom = alias(rooms, "asset_room");
  const rows = ctx.db
    .select({
      task: tasks,
      state: taskState,
      assetName: assets.name,
      ownRoomName: rooms.name,
      assetRoomName: assetRoom.name,
    })
    .from(tasks)
    .innerJoin(taskState, eq(taskState.taskId, tasks.id))
    .leftJoin(assets, eq(assets.id, tasks.assetId))
    .leftJoin(rooms, eq(rooms.id, tasks.roomId))
    .leftJoin(assetRoom, eq(assetRoom.id, assets.roomId))
    // A defect's reminder task is the defect's deadline: the defect event stands for it.
    .where(
      and(
        isNull(tasks.archivedAt),
        or(isNull(tasks.externalSource), ne(tasks.externalSource, "defect")),
      ),
    )
    .all()
    .map((r) => ({ ...r, state: toStateRecord(r.state) }))
    .filter(
      (r) =>
        r.state.status !== "snoozed" &&
        !(r.task.snoozedUntil && r.task.snoozedUntil > today) &&
        (feed.scope === "all" ||
          r.task.assignMode === "none" ||
          r.state.currentAssigneeUserId === feed.userId),
    );

  const place = (
    asset: string | null,
    room: string | null,
    extra: string[] = [],
  ) =>
    [
      ...(asset ? [m.cal_asset_line({ name: asset }, o)] : []),
      ...(room ? [m.cal_room_line({ name: room }, o)] : []),
      ...extra,
    ].join("\n");

  const dated = new Map<string, Dated>();
  for (const r of rows) {
    const when = datedOf(r.state, feed, today);
    if (!when) continue;
    dated.set(r.task.id, when);
    const room = r.ownRoomName ?? r.assetRoomName;
    const due = stateToDue(r.state);
    const span =
      !when.estimated && due.windowStart && due.windowStart < when.date
        ? { start: due.windowStart, end: addDays(when.date, 1) }
        : null;
    events.push({
      uid: `task-${uidPart(r.task.id)}-${uidPart(r.state.occurrenceKey)}@hauswart`,
      date: span ?? when.date,
      summary: `${when.estimated ? "~ " : ""}${r.task.title}`,
      description: place(r.assetName, room, [
        ...(span
          ? [m.cal_window_note({ from: span.start, to: when.date }, o)]
          : []),
        ...(when.estimated ? [m.cal_estimated_note({}, o)] : []),
      ]),
      url: `${origin}/tasks/${r.task.id}`,
      status: when.estimated ? "TENTATIVE" : "CONFIRMED",
      sequence: sequenceOf(r.task.updatedAt.getTime()),
      lastModified: r.task.updatedAt.getTime(),
      categories: [CATEGORY[r.task.category]({}, o)],
      ...(alarm && !when.estimated ? { alarm } : {}),
    });
  }

  if (feed.includePreparations && dated.size > 0) {
    const states = new Map(
      rows.filter((r) => dated.has(r.task.id)).map((r) => [r.task.id, r.state]),
    );
    const byTask = new Map(rows.map((r) => [r.task.id, r]));
    const preps = await preparationsForTasks(ctx, states);
    for (const [taskId, list] of preps) {
      const r = byTask.get(taskId)!;
      const when = dated.get(taskId)!;
      for (const prep of list) {
        if (prep.state === "done" || prep.state === "in_stock_skip") continue;
        const date =
          prep.leadDays !== null
            ? addDays(when.date, -prep.leadDays)
            : prep.state === "now"
              ? when.date
              : null;
        if (date === null) continue;
        const modified = Math.max(
          r.task.updatedAt.getTime(),
          prep.updatedAt.getTime(),
        );
        events.push({
          uid: `prep-${uidPart(prep.id)}-${uidPart(r.state.occurrenceKey)}@hauswart`,
          date,
          summary: `${when.estimated ? "~ " : ""}${m.cal_prep_summary({ title: prep.title }, o)}`,
          description: [
            m.cal_prep_for({ task: r.task.title }, o),
            ...(when.estimated ? [m.cal_estimated_note({}, o)] : []),
          ].join("\n"),
          url: `${origin}/tasks/${r.task.id}`,
          status: when.estimated ? "TENTATIVE" : "CONFIRMED",
          sequence: sequenceOf(modified),
          lastModified: modified,
          ...(alarm && !when.estimated ? { alarm } : {}),
        });
      }
    }
  }

  if (feed.includeDefects) {
    const defectRoom = alias(rooms, "defect_room");
    const open = ctx.db
      .select({
        defect: defects,
        roomName: defectRoom.name,
        assetName: assets.name,
      })
      .from(defects)
      .leftJoin(defectRoom, eq(defectRoom.id, defects.roomId))
      .leftJoin(assets, eq(assets.id, defects.assetId))
      .where(
        and(
          isNotNull(defects.deadlineDate),
          notInArray(defects.status, ["fixed", "rejected"]),
        ),
      )
      .all();
    for (const { defect, roomName, assetName } of open) {
      events.push({
        uid: `defect-${uidPart(defect.id)}-deadline@hauswart`,
        date: defect.deadlineDate as string,
        summary: m.cal_defect_summary(
          { number: defect.number, title: defect.title },
          o,
        ),
        description: place(assetName, roomName),
        url: `${origin}/defects/${defect.id}`,
        sequence: sequenceOf(defect.updatedAt.getTime()),
        lastModified: defect.updatedAt.getTime(),
        ...(alarm ? { alarm } : {}),
      });
    }
  }

  if (feed.includeWarranties) {
    const until = addDays(today, WARRANTY_HORIZON_DAYS);
    const withWarranty = ctx.db
      .select({ asset: assets, roomName: rooms.name })
      .from(assets)
      .leftJoin(rooms, eq(rooms.id, assets.roomId))
      .where(isNull(assets.archivedAt))
      .all();
    for (const { asset, roomName } of withWarranty) {
      const ends =
        asset.warrantyUntil && asset.warrantyExtendedUntil
          ? maxDate(asset.warrantyUntil, asset.warrantyExtendedUntil)
          : (asset.warrantyUntil ?? asset.warrantyExtendedUntil);
      if (!ends || ends < today || ends > until) continue;
      events.push({
        uid: `warranty-${uidPart(asset.id)}@hauswart`,
        date: ends,
        summary: m.cal_warranty_summary({ name: asset.name }, o),
        description: place(null, roomName, [
          m.cal_warranty_line({ date: ends }, o),
        ]),
        url: `${origin}/assets/${asset.id}`,
        sequence: sequenceOf(asset.updatedAt.getTime()),
        lastModified: asset.updatedAt.getTime(),
        ...(alarm ? { alarm } : {}),
      });
    }
  }

  events.sort((a, b) => {
    const start = (e: IcsEvent) =>
      typeof e.date === "string" ? e.date : e.date.start;
    return start(a).localeCompare(start(b)) || a.uid.localeCompare(b.uid);
  });

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
