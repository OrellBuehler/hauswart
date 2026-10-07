import { and, eq, isNull, like } from "drizzle-orm";
import { FINANCE_BILL_TASK_SOURCE, type IntegrationKind } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import { formatAmount, minor } from "$lib/money";
import { connections, taskCompletions, tasks } from "$lib/server/db";
import { completeTask } from "$lib/server/tasks/completions";
import { evaluateTaskById } from "$lib/server/tasks/evaluator";
import {
  createTask,
  updateTask,
  type TaskRecord,
} from "$lib/server/tasks/tasks";
import type { ServiceContext } from "$lib/server/service";
import { completionSourceFor, taskSourceFor } from "./providers";

export const FINANCE_BILL_SOURCE = FINANCE_BILL_TASK_SOURCE;

/** The system text of these tasks is stored, so it is written in the base language of the app. */
const BASE = { locale: "de" } as const;

export type BillTaskStatus = "open" | "overdue" | "paid" | "cancelled";

export interface BillTaskInput {
  /** The connection (and so the person) the bill belongs to; the task is assigned to that person. */
  connectionId: string;
  kind: IntegrationKind;
  ownerId: string;
  billId: string;
  title: string;
  dueDate: string;
  status: BillTaskStatus;
  /** What is still to pay, minor units; null for a bill without a fixed amount. */
  amountMinor: number | null;
  currency: string;
  url: string | null;
}

export type BillTaskOutcome =
  "created" | "updated" | "completed" | "reopened" | "unchanged" | "skipped";

const refOf = (connectionId: string, billId: string) =>
  `${connectionId}:${billId}`;

function findBillTask(
  ctx: Pick<ServiceContext, "db">,
  connectionId: string,
  billId: string,
) {
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.externalSource, FINANCE_BILL_SOURCE),
        eq(tasks.externalRef, refOf(connectionId, billId)),
      ),
    )
    .get();
}

function describe(input: BillTaskInput): string {
  if (input.amountMinor === null) return "";
  return m.finance_bill_task_description(
    {
      amount: formatAmount(minor(input.amountMinor), input.currency, "de-CH"),
      due: input.dueDate,
    },
    BASE,
  );
}

const triggerOf = (input: BillTaskInput) => ({
  v: 1 as const,
  type: "kept_bill" as const,
  billId: input.billId,
  dueDate: input.dueDate,
  status: input.status,
});

function activeCompletions(
  ctx: Pick<ServiceContext, "db">,
  taskId: string,
  kind: IntegrationKind,
) {
  return ctx.db
    .select({ id: taskCompletions.id })
    .from(taskCompletions)
    .where(
      and(
        eq(taskCompletions.taskId, taskId),
        eq(taskCompletions.source, completionSourceFor(kind)),
        isNull(taskCompletions.revokedAt),
      ),
    )
    .all();
}

/**
 * Who may see the address of a bill in the finance app: the person whose
 * connection the task follows. The task itself (creditor, amount, due date) is
 * for the household; where the bill lives in somebody's private finance app is
 * not. Returns a check for the tasks of one response; it asks the database
 * for the person's connections only if a bill task turns up.
 */
export function billUrlVisibility(
  ctx: Pick<ServiceContext, "db">,
  userId: string,
): (task: {
  externalSource: string | null;
  externalRef: string | null;
}) => boolean {
  let own: Set<string> | undefined;
  return (task) => {
    if (task.externalSource !== FINANCE_BILL_SOURCE) return true;
    own ??= new Set(
      ctx.db
        .select({ id: connections.id })
        .from(connections)
        .where(eq(connections.userId, userId))
        .all()
        .map((c) => c.id),
    );
    return own.has((task.externalRef ?? "").split(":")[0]);
  };
}

/** Whether the occurrence of this bill is settled already (a done or a skip that was not undone). */
function occurrenceSettled(
  ctx: Pick<ServiceContext, "db">,
  taskId: string,
  billId: string,
): boolean {
  return (
    ctx.db
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(
        and(
          eq(taskCompletions.taskId, taskId),
          eq(taskCompletions.occurrenceKey, `bill:${billId}`),
          isNull(taskCompletions.revokedAt),
        ),
      )
      .limit(1)
      .all().length > 0
  );
}

/**
 * Keeps the task of one bill in step with the bill: created while the bill
 * needs paying, due on its due date, assigned to the person whose finance
 * system it came from. A paid bill completes the task (a system completion
 * attributed to the provider, unless a person settled it before); a bill that
 * is open again takes that back, but never what a person recorded.
 * A cancelled bill settles the task without a completion. Tasks someone
 * archived are left alone. Nothing is created for a bill that is already
 * paid or cancelled. The task shows the creditor, the amount and the due
 * date to the whole household: that is what the person agreed to by
 * switching bill tasks on.
 */
export async function upsertFinanceBillTask(
  ctx: ServiceContext,
  input: BillTaskInput,
): Promise<{ outcome: BillTaskOutcome; taskId: string | null }> {
  const existing = findBillTask(ctx, input.connectionId, input.billId);
  const trigger = triggerOf(input);
  const descriptionMd = describe(input);

  if (!existing) {
    if (input.status === "paid" || input.status === "cancelled") {
      return { outcome: "skipped", taskId: null };
    }
    const task = await createTask(
      ctx,
      {
        title: input.title,
        descriptionMd,
        category: "payment",
        priority: "normal",
        trigger,
        assignMode: "fixed",
        assigneeUserId: input.ownerId,
        rotationOrder: [],
        rotationStrategy: "alternate",
        notifyMode: "assignee",
        graceDays: 0,
        source: taskSourceFor(input.kind),
        externalSource: FINANCE_BILL_SOURCE,
        externalRef: refOf(input.connectionId, input.billId),
        externalUrl: input.url,
      },
      null,
    );
    return { outcome: "created", taskId: task.id };
  }
  if (existing.archivedAt) return { outcome: "skipped", taskId: existing.id };

  let outcome: BillTaskOutcome = "unchanged";
  const done = activeCompletions(ctx, existing.id, input.kind);
  if (
    input.status === "paid" &&
    done.length === 0 &&
    !occurrenceSettled(ctx, existing.id, input.billId)
  ) {
    await completeTask(ctx, existing.id, {
      kind: "done",
      source: completionSourceFor(input.kind),
      userId: null,
      occurrenceKey: `bill:${input.billId}`,
    });
    outcome = "completed";
  } else if (
    (input.status === "open" || input.status === "overdue") &&
    done.length > 0
  ) {
    ctx.db
      .update(taskCompletions)
      .set({ revokedAt: new Date(ctx.now), revokedBy: null })
      .where(
        and(
          eq(taskCompletions.taskId, existing.id),
          eq(taskCompletions.source, completionSourceFor(input.kind)),
          isNull(taskCompletions.revokedAt),
        ),
      )
      .run();
    outcome = "reopened";
  }

  const stored = JSON.stringify(existing.trigger);
  const changed =
    existing.title !== input.title ||
    existing.descriptionMd !== descriptionMd ||
    existing.externalUrl !== input.url ||
    stored !== JSON.stringify(trigger);
  if (changed) {
    await updateTask(ctx, existing.id, {
      title: input.title,
      descriptionMd,
      externalUrl: input.url,
      trigger,
    });
    if (outcome === "unchanged") outcome = "updated";
  } else if (outcome !== "unchanged") {
    await evaluateTaskById(ctx, existing.id);
  }
  return { outcome, taskId: existing.id };
}

export interface BillTaskRef {
  taskId: string;
  billId: string;
  status: BillTaskStatus;
  dueDate: string;
  updatedAt: Date;
}

/** The active tasks that follow bills of this connection. */
export function activeBillTasks(
  ctx: Pick<ServiceContext, "db">,
  connectionId: string,
): BillTaskRef[] {
  const prefix = `${connectionId}:`;
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.externalSource, FINANCE_BILL_SOURCE),
        like(tasks.externalRef, `${prefix}%`),
        isNull(tasks.archivedAt),
      ),
    )
    .all()
    .flatMap((t) =>
      t.trigger.type === "kept_bill" && t.externalRef
        ? [
            {
              taskId: t.id,
              billId: t.externalRef.slice(prefix.length),
              status: t.trigger.status as BillTaskStatus,
              dueDate: t.trigger.dueDate as string,
              updatedAt: t.updatedAt,
            },
          ]
        : [],
    );
}

export async function archiveBillTask(
  ctx: ServiceContext,
  taskId: string,
): Promise<TaskRecord> {
  return updateTask(ctx, taskId, { archived: true });
}

const DAY_MS = 86_400_000;
export const FINISHED_BILL_TASK_DAYS = 90;

/**
 * Housekeeping: archives the tasks of bills that are long paid or cancelled,
 * and those of a connection that no longer exists. Returns how many.
 */
export async function archiveSettledBillTasks(
  ctx: ServiceContext,
): Promise<number> {
  const live = new Set(
    ctx.db
      .select({ id: connections.id })
      .from(connections)
      .all()
      .map((c) => c.id),
  );
  const rows = ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.externalSource, FINANCE_BILL_SOURCE),
        isNull(tasks.archivedAt),
      ),
    )
    .all();
  let archived = 0;
  for (const t of rows) {
    const connectionId = t.externalRef?.split(":")[0] ?? "";
    const finished =
      (t.trigger.type === "kept_bill" &&
        (t.trigger.status === "paid" || t.trigger.status === "cancelled") &&
        ctx.now - t.updatedAt.getTime() > FINISHED_BILL_TASK_DAYS * DAY_MS) ||
      !live.has(connectionId);
    if (finished) {
      await updateTask(ctx, t.id, { archived: true });
      archived++;
    }
  }
  return archived;
}
