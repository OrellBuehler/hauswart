import { and, eq, isNull } from "drizzle-orm";
import { cancellationDeadline } from "$lib/insurance/policy";
import { m } from "$lib/paraglide/messages";
import { taskCompletions, tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { createPreparation } from "$lib/server/tasks/preparations";
import { createTask, getTask, updateTask } from "$lib/server/tasks/tasks";
import type { PolicyRow } from "./policies";

export const INSURANCE_EXTERNAL_SOURCE = "insurance";

/** The task is due on the real deadline; it turns "due soon" this many days before. */
export const REMINDER_DUE_SOON_DAYS = 14;
/** The preparation "compare and prepare" becomes relevant this many days before the deadline. */
export const REMINDER_PREP_LEAD_DAYS = 30;

/** The system task is stored text, so it is written in the base language of the app. */
const BASE = { locale: "de" } as const;

/** A finished reminder is kept under `<policy id>@<task id>` so the policy can have a new one under its own id. */
export const reminderRefPrefix = (policyId: string) => `${policyId}@`;

type ReminderInput = Pick<
  PolicyRow,
  | "id"
  | "title"
  | "renewal"
  | "endDate"
  | "cancellationNoticeMonths"
  | "archivedAt"
>;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function isSettled(ctx: Pick<ServiceContext, "db">, taskId: string): boolean {
  return (
    ctx.db
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(
        and(
          eq(taskCompletions.taskId, taskId),
          isNull(taskCompletions.revokedAt),
        ),
      )
      .get() !== undefined
  );
}

/**
 * Keeps one reminder task per policy in step with it: a one-off task that is due on the
 * cancellation deadline itself (so every date anywhere is the real one), turns "due soon" two
 * weeks before and has a preparation a month ahead. It exists while the policy is active and its
 * deadline is today or later; it is archived when the policy is archived, the deadline goes away
 * or moves into the past, and comes back when they return. A reminder nobody has dealt with stays
 * (overdue) when its deadline passes, as long as the deadline is the one it was made for.
 *
 * A one-off task stays done once it was completed, so when the deadline moves (the contract was
 * renewed and the end date pushed out) a finished task is archived with its history and the policy
 * gets a new one for the new deadline.
 */
export async function syncReminder(
  ctx: ServiceContext,
  policy: ReminderInput,
): Promise<void> {
  const { today } = clockAt(ctx.now);
  const deadline = policy.archivedAt ? null : cancellationDeadline(policy);
  const wanted = deadline !== null && deadline >= today ? deadline : null;

  const existing = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.externalSource, INSURANCE_EXTERNAL_SOURCE),
        eq(tasks.externalRef, policy.id),
      ),
    )
    .get();
  let current = existing ? getTask(ctx, existing.id) : undefined;

  if (wanted === null) {
    if (current && !current.archivedAt) {
      // A reminder nobody has dealt with whose deadline has passed is overdue, which is what it
      // is for. An edit that does not touch the deadline (notes, premium) must not hide it.
      const overdue =
        deadline !== null &&
        current.trigger.type === "one_off" &&
        current.trigger.date === deadline &&
        !isSettled(ctx, current.id);
      if (!overdue) await updateTask(ctx, current.id, { archived: true });
    }
    return;
  }

  if (
    current &&
    current.trigger.type === "one_off" &&
    current.trigger.date !== wanted &&
    isSettled(ctx, current.id)
  ) {
    ctx.db
      .update(tasks)
      .set({ externalRef: `${reminderRefPrefix(policy.id)}${current.id}` })
      .where(eq(tasks.id, current.id))
      .run();
    if (!current.archivedAt) {
      await updateTask(ctx, current.id, { archived: true });
    }
    current = undefined;
  }

  const fields = {
    title: m.insurance_reminder_title({ title: clip(policy.title, 160) }, BASE),
    trigger: { v: 1 as const, type: "one_off" as const, date: wanted },
    dueSoonDays: REMINDER_DUE_SOON_DAYS,
    externalUrl: `/insurance/${policy.id}`,
  };
  if (current) {
    await updateTask(ctx, current.id, { ...fields, archived: false });
    return;
  }
  const task = await createTask(
    ctx,
    {
      ...fields,
      descriptionMd: "",
      category: "payment",
      priority: "normal",
      assignMode: "none",
      rotationOrder: [],
      rotationStrategy: "alternate",
      notifyMode: "all",
      graceDays: 0,
      source: "system",
      externalSource: INSURANCE_EXTERNAL_SOURCE,
      externalRef: policy.id,
    },
    null,
  );
  await createPreparation(ctx, task.id, {
    title: m.insurance_reminder_prep({}, BASE),
    kind: "generic",
    leadDays: REMINDER_PREP_LEAD_DAYS,
    qty: 1,
  });
}
