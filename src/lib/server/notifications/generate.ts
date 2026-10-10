import { eq, isNull } from "drizzle-orm";
import { addDays, diffDays, zonedTimeToInstant } from "$lib/dates";
import type { NotificationKind, NotificationTitleKey } from "$lib/api/enums";
import { taskState, tasks, users } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { preparationsForTasks } from "$lib/server/tasks/preparations";
import { toStateRecord, type TaskStateRecord } from "$lib/server/tasks/state";
import type {
  DeliverableNotification,
  NotificationRecipient,
} from "./channels";
import { deliverToChannels } from "./deliveries";
import { createNotification } from "./notifications";

/** An overdue task is announced when it becomes overdue and then weekly, four times in all. */
export const OVERDUE_REMINDERS = 4;
const OVERDUE_REPEAT_DAYS = 7;

type TaskRow = typeof tasks.$inferSelect;

interface Candidate {
  task: TaskRow;
  state: TaskStateRecord;
}

export interface GenerationSummary {
  created: number;
}

function recipientsFor(
  { task, state }: Candidate,
  people: NotificationRecipient[],
): NotificationRecipient[] {
  if (
    task.assignMode !== "none" &&
    task.notifyMode === "assignee" &&
    state.currentAssigneeUserId
  ) {
    const assignee = people.find((p) => p.id === state.currentAssigneeUserId);
    if (assignee) return [assignee];
  }
  return people;
}

function isSnoozed({ task, state }: Candidate, today: string): boolean {
  return (
    state.status === "snoozed" ||
    (task.snoozedUntil !== null && task.snoozedUntil > today)
  );
}

function soonDaysOf(task: TaskRow, fallback: number): number {
  return task.dueSoonDays ?? fallback;
}

/**
 * `open` within the lead window; progress-based tasks (x per month) only speak up once due. A
 * counter task with a time limit has progress too, but its date is a fixed one (`exact`), so it
 * does announce that.
 */
function isDueSoon(c: Candidate, today: string, fallback: number): boolean {
  const { state } = c;
  return (
    state.status === "open" &&
    state.dueDate !== null &&
    (state.progress === null || state.dueKind === "exact") &&
    diffDays(state.dueDate, today) <= soonDaysOf(c.task, fallback)
  );
}

/**
 * Turns the cached verdicts into notifications: a preparation that has become
 * relevant, a task coming up, due, or overdue (weekly, four times), and one
 * digest per person per day at the household's digest time. Safe to run as
 * often as you like: every notification has a dedupe key, so a stage is
 * announced once per person and occurrence. Snoozed tasks stay silent.
 */
export async function generateNotifications(
  ctx: ServiceContext,
): Promise<GenerationSummary> {
  const clock = clockAt(ctx.now);
  const { today } = clock;
  const settings = getHousehold(ctx).settings;
  const people: NotificationRecipient[] = ctx.db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .all();
  if (people.length === 0) return { created: 0 };

  const candidates: Candidate[] = ctx.db
    .select({ task: tasks, state: taskState })
    .from(tasks)
    .innerJoin(taskState, eq(taskState.taskId, tasks.id))
    .where(isNull(tasks.archivedAt))
    .all()
    .map(({ task, state }) => ({ task, state: toStateRecord(state) }));
  const active = candidates.filter((c) => !isSnoozed(c, today));
  const preps = await preparationsForTasks(
    ctx,
    new Map(active.map((c) => [c.task.id, c.state])),
  );

  const delivered: [DeliverableNotification, NotificationRecipient[]][] = [];
  const emit = (
    recipients: NotificationRecipient[],
    spec: {
      kind: NotificationKind;
      taskId: string | null;
      key: string;
      titleKey: NotificationTitleKey;
      params: Record<string, string | number>;
      url: string;
      occurrenceKey?: string;
    },
  ) => {
    for (const person of recipients) {
      const row = createNotification(ctx, {
        userId: person.id,
        kind: spec.kind,
        taskId: spec.taskId,
        dedupeKey: `${spec.key}:${person.id}`,
        titleKey: spec.titleKey,
        params: spec.params,
        url: spec.url,
      });
      if (row) {
        delivered.push([
          {
            id: row.id,
            userId: row.userId,
            kind: row.kind,
            taskId: row.taskId,
            titleKey: row.titleKey,
            params: row.paramsJson,
            url: row.url,
            createdAt: row.createdAt,
            occurrenceKey: spec.occurrenceKey ?? null,
          },
          [person],
        ]);
      }
    }
  };

  for (const candidate of active) {
    const { task, state } = candidate;
    const recipients = recipientsFor(candidate, people);
    const base = `${task.id}:${state.occurrenceKey}`;
    const date = state.dueDate ?? state.estimate?.date ?? "";
    const url = `/tasks/${task.id}`;

    for (const prep of preps.get(task.id) ?? []) {
      if (prep.state !== "now") continue;
      emit(recipients, {
        kind: "prep",
        taskId: task.id,
        key: `${base}:prep-${prep.id}`,
        titleKey: "notification_prep",
        params: { title: task.title, prep: prep.title, date },
        url,
        occurrenceKey: state.occurrenceKey,
      });
    }

    if (isDueSoon(candidate, today, settings.dueSoonDays)) {
      emit(recipients, {
        kind: "due_soon",
        taskId: task.id,
        key: `${base}:due_soon`,
        titleKey: "notification_due_soon",
        params: { title: task.title, date },
        url,
        occurrenceKey: state.occurrenceKey,
      });
    } else if (state.status === "due") {
      emit(recipients, {
        kind: "due",
        taskId: task.id,
        key: `${base}:due`,
        titleKey: "notification_due",
        params: { title: task.title, date },
        url,
        occurrenceKey: state.occurrenceKey,
      });
    } else if (state.status === "overdue" && state.dueDate) {
      const sinceOverdue = diffDays(
        today,
        addDays(state.dueDate, task.graceDays + 1),
      );
      const n = Math.floor(sinceOverdue / OVERDUE_REPEAT_DAYS);
      if (n < OVERDUE_REMINDERS) {
        emit(recipients, {
          kind: "overdue",
          taskId: task.id,
          key: `${base}:overdue:${n}`,
          titleKey: "notification_overdue",
          params: {
            title: task.title,
            date: state.dueDate,
            days: diffDays(today, state.dueDate),
          },
          url,
          occurrenceKey: state.occurrenceKey,
        });
      }
    }
  }

  const digestAt = zonedTimeToInstant(today, settings.digestTime, clock.tz);
  if (ctx.now >= digestAt) {
    for (const person of people) {
      const mine = active.filter((c) =>
        recipientsFor(c, people).some((p) => p.id === person.id),
      );
      const overdue = mine.filter((c) => c.state.status === "overdue").length;
      const due = mine.filter((c) => c.state.status === "due").length;
      const soon = mine.filter((c) =>
        isDueSoon(c, today, settings.dueSoonDays),
      ).length;
      if (overdue + due + soon === 0) continue;
      emit([person], {
        kind: "digest",
        taskId: null,
        key: `digest:${today}`,
        titleKey: "notification_digest",
        params: { overdue, due, soon },
        url: "/",
      });
    }
  }

  for (const [notification, recipients] of delivered) {
    await deliverToChannels(ctx, notification, recipients);
  }
  return { created: delivered.length };
}
