import type { NotificationTitleKey } from "../../src/lib/api/enums";
import type { Asset } from "../../src/lib/api/schemas/assets";
import type { Notification } from "../../src/lib/api/schemas/notifications";
import type { Completion, Task } from "../../src/lib/api/schemas/tasks";
import type { Trigger } from "../../src/lib/tasks/engine/types";
import { isOdometerKey } from "../../src/lib/vehicles/odometer";

/** Drops `null` and `undefined` recursively: an absent field means "none", which saves tokens. */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, compact(v)]),
    );
  }
  return value;
}

export type UserNames = Map<string, string>;

const nameOf = (users: UserNames, id: string | null) =>
  id ? (users.get(id) ?? id) : null;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One line a person would say: "every 3 months (from completion)". */
export function describeTrigger(t: Trigger): string {
  const every = (n: number, unit: string) =>
    n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  switch (t.type) {
    case "interval": {
      const base = `${every(t.every, t.unit)}, counted from ${t.anchor === "completion" ? "the last completion" : "the schedule"}`;
      return t.seasons?.length ? `${base}, with seasonal changes` : base;
    }
    case "calendar": {
      const unit = { weekly: "week", monthly: "month", yearly: "year" }[t.freq];
      const parts = [every(t.interval, unit)];
      if (t.byWeekday)
        parts.push(`on ${t.byWeekday.map((d) => WEEKDAYS[d - 1]).join("/")}`);
      if (t.nth !== undefined) parts.push(`(occurrence ${t.nth})`);
      if (t.byMonthDay !== undefined) parts.push(`on day ${t.byMonthDay}`);
      if (t.byMonth)
        parts.push(`in ${t.byMonth.map((m) => MONTHS[m - 1]).join("/")}`);
      return parts.join(" ");
    }
    case "min_per_period":
      return `at least ${t.count}x per ${t.period}`;
    case "counter_delta": {
      const on = isOdometerKey(t.entityId) ? "the odometer" : t.entityId;
      const base = `every ${t.threshold}${t.unit ? ` ${t.unit}` : ""} on ${on}`;
      return t.orEvery
        ? `${base}, or ${every(t.orEvery.every, t.orEvery.unit)}, whichever comes first`
        : base;
    }
    case "state_condition":
      return `when ${t.entityId} ${t.op} ${t.value}`;
    case "ha_calendar":
      return `calendar ${t.entityId}, ${t.offsetDays} days offset`;
    case "one_off":
      return `once on ${t.date}`;
    case "kept_bill":
      return `bill ${t.billId} (${t.status}), due ${t.dueDate}`;
    case "warranty":
      return `warranty until ${t.extendedUntil ?? t.until}`;
  }
}

export function taskRow(task: Task, users: UserNames) {
  const state = task.state;
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority === "normal" ? null : task.priority,
    status: state?.status,
    due: state?.dueDate,
    dueKind: state && state.dueKind !== "exact" ? state.dueKind : null,
    estimate: state?.estimate?.date,
    progress: state?.progress,
    missed: state?.missedCount ? state.missedCount : null,
    schedule: describeTrigger(task.trigger),
    asset: task.assetName,
    assetId: task.assetId,
    room: task.roomName,
    assignee: nameOf(users, state?.currentAssigneeUserId ?? null),
    effortMinutes: task.effortMinutes,
    snoozedUntil: task.snoozedUntil,
    archived: task.archivedAt ? true : null,
  };
}

export function completionRow(c: Completion) {
  return {
    id: c.id,
    kind: c.kind,
    date: c.completedDate,
    by: c.userName,
    source: c.source,
    note: c.note,
    revoked: c.revokedAt ? true : null,
  };
}

export function assetRow(a: Asset) {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    room: a.roomName,
    roomId: a.roomId,
    category: a.category,
    manufacturer: a.manufacturer,
    model: a.model,
    warrantyUntil: a.warrantyUntil,
    warrantyExtendedUntil: a.warrantyExtendedUntil,
    archived: a.archivedAt ? true : null,
  };
}

const NOTIFICATION_TEXT: Record<
  NotificationTitleKey,
  (p: Notification["params"]) => string
> = {
  notification_prep: (p) => `Prepare: ${p.prep} for "${p.title}" (${p.date})`,
  notification_due_soon: (p) => `"${p.title}" is due soon (${p.date})`,
  notification_due: (p) => `"${p.title}" is due (${p.date})`,
  notification_overdue: (p) =>
    `"${p.title}" has been overdue for ${p.days} days (was due ${p.date})`,
  notification_digest: (p) =>
    `Today: ${p.overdue} overdue, ${p.due} due, ${p.soon} due soon`,
  notification_info: (p) => String(p.message),
  notification_comment: (p) => `${p.author} commented on "${p.title}"`,
  notification_hint: (p) => `${p.asset}: ${p.title}`,
};

export function renderNotification(n: Notification): string {
  return NOTIFICATION_TEXT[n.titleKey](n.params);
}

/** `1 task`, `2 tasks`. */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** `... more available (pass cursor "x")` for paginated lists. */
export function moreHint(nextCursor: string | null): string {
  return nextCursor ? ` More available: pass cursor "${nextCursor}".` : "";
}
