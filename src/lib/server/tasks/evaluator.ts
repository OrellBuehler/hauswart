import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  evaluateTask,
  nextAssignee,
  triggerSchema,
  type Completion,
  type DueResult,
  type Trigger,
} from "$lib/tasks/engine";
import { dateInZone, householdTimeZone } from "$lib/server/config";
import { taskCompletions, taskState, tasks } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import { parseStored } from "$lib/server/json";
import type { ServiceContext } from "$lib/server/service";
import { loadSignals, triggerSignalNeeds } from "./signals";
import { toStateRecord, type StateRow, type TaskStateRecord } from "./state";

type TaskRow = typeof tasks.$inferSelect;

/** Effort assumed for a task without an estimate when balancing a "fair" rotation. */
export const DEFAULT_EFFORT_MINUTES = 15;
const FAIR_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface Clock {
  now: number;
  today: string;
  tz: string;
}

export function clockAt(now: number): Clock {
  const tz = householdTimeZone();
  return { now, today: dateInZone(now, tz), tz };
}

function toCompletion(row: typeof taskCompletions.$inferSelect): Completion {
  return {
    id: row.id,
    completedAt: row.completedAt.getTime(),
    completedDate: row.completedDate,
    userId: row.userId,
    kind: row.kind,
    counterValue: row.counterValue,
    occurrenceKey: row.occurrenceKey,
  };
}

/** Minutes of work each user did in the last 90 days; the input of the "fair" rotation. */
export function effortByUser(ctx: ServiceContext): Record<string, number> {
  const rows = ctx.db
    .select({
      userId: taskCompletions.userId,
      minutes: sql<number>`sum(coalesce(${tasks.effortMinutes}, ${DEFAULT_EFFORT_MINUTES}))`,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(taskCompletions.kind, "done"),
        isNull(taskCompletions.revokedAt),
        gte(taskCompletions.completedAt, new Date(ctx.now - FAIR_WINDOW_MS)),
      ),
    )
    .groupBy(taskCompletions.userId)
    .all();
  const out: Record<string, number> = {};
  for (const row of rows) if (row.userId) out[row.userId] = Number(row.minutes);
  return out;
}

interface Batch {
  clock: Clock;
  dueSoonDays: number;
  completions: Map<string, Completion[]>;
  previous: Map<string, StateRow>;
  signals: Awaited<ReturnType<typeof loadSignals>>;
  effort: () => Record<string, number>;
}

function verdict(task: TaskRow, trigger: Trigger, batch: Batch): DueResult {
  const prev = batch.previous.get(task.id);
  return evaluateTask({
    trigger,
    completions: batch.completions.get(task.id) ?? [],
    signals: batch.signals.signals,
    samples: batch.signals.samples,
    externalDates: batch.signals.externalDates,
    state: {
      ...(prev?.counterBaseline == null
        ? {}
        : { counterBaseline: prev.counterBaseline }),
      ...(prev?.activeSince == null ? {} : { activeSince: prev.activeSince }),
      ...(prev?.dueSince == null ? {} : { dueSince: prev.dueSince }),
    },
    today: batch.clock.today,
    now: batch.clock.now,
    tz: batch.clock.tz,
    graceDays: task.graceDays,
    dueSoonDays: task.dueSoonDays ?? batch.dueSoonDays,
    snoozedUntil: task.snoozedUntil,
  });
}

function assigneeFor(task: TaskRow, batch: Batch): string | null {
  return nextAssignee(
    {
      mode: task.assignMode,
      assigneeUserId: task.assigneeUserId,
      rotationOrder: task.rotationOrder,
      strategy: task.rotationStrategy,
    },
    batch.completions.get(task.id) ?? [],
    task.assignMode === "rotate" && task.rotationStrategy === "fair"
      ? batch.effort()
      : {},
  );
}

function writeState(
  ctx: ServiceContext,
  task: TaskRow,
  trigger: Trigger,
  batch: Batch,
): StateRow {
  const result = verdict(task, trigger, batch);
  const prev = batch.previous.get(task.id);
  const now = batch.clock.now;
  const values = {
    taskId: task.id,
    status: result.status,
    dueDate: result.dueDate,
    dueKind: result.dueKind,
    occurrenceKey: result.occurrenceKey,
    windowStart: result.windowStart ?? null,
    progressJson: result.progress ?? null,
    estimateJson: result.estimate ?? null,
    missedCount: result.missedCount ?? 0,
    reasonsJson: result.reasons,
    currentAssigneeUserId: assigneeFor(task, batch),
    counterBaseline: prev?.counterBaseline ?? null,
    activeSince: prev?.activeSince ?? null,
    // A condition that is met keeps the instant it first was; anything else resets it.
    dueSince:
      result.dueKind === "condition" && result.dueDate !== null
        ? (prev?.dueSince ?? now)
        : null,
    evaluatedAt: new Date(now),
  };
  return ctx.db
    .insert(taskState)
    .values(values)
    .onConflictDoUpdate({
      target: taskState.taskId,
      set: { ...values, updatedAt: new Date(now) },
    })
    .returning()
    .get();
}

async function buildBatch(
  ctx: ServiceContext,
  rows: TaskRow[],
  triggers: Map<string, Trigger>,
): Promise<Batch> {
  const ids = rows.map((r) => r.id);
  const completions = new Map<string, Completion[]>();
  const previous = new Map<string, StateRow>();
  // Chunked: SQLite caps the number of bound parameters per statement.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const row of ctx.db
      .select()
      .from(taskCompletions)
      .where(
        and(
          inArray(taskCompletions.taskId, chunk),
          isNull(taskCompletions.revokedAt),
        ),
      )
      // Newest first: the engine keeps the first of equal instants, so a later
      // completion recorded in the same millisecond still wins.
      .orderBy(
        desc(taskCompletions.completedAt),
        desc(taskCompletions.createdAt),
        desc(sql`${taskCompletions}.rowid`),
      )
      .all()) {
      const list = completions.get(row.taskId) ?? [];
      list.push(toCompletion(row));
      completions.set(row.taskId, list);
    }
    for (const row of ctx.db
      .select()
      .from(taskState)
      .where(inArray(taskState.taskId, chunk))
      .all()) {
      previous.set(row.taskId, row);
    }
  }
  const signals = await loadSignals(
    triggerSignalNeeds([...triggers.values()]),
    ctx.now,
  );
  let effort: Record<string, number> | null = null;
  return {
    clock: clockAt(ctx.now),
    dueSoonDays: getHousehold(ctx).settings.dueSoonDays,
    completions,
    previous,
    signals,
    effort: () => (effort ??= effortByUser(ctx)),
  };
}

export interface EvaluationSummary {
  evaluated: number;
  failed: number;
}

async function evaluateRows(
  ctx: ServiceContext,
  rows: TaskRow[],
  options: { throwOnError: boolean },
): Promise<EvaluationSummary> {
  const triggers = new Map<string, Trigger>();
  let failed = 0;
  const valid: TaskRow[] = [];
  for (const row of rows) {
    try {
      triggers.set(
        row.id,
        parseStored(triggerSchema, row.trigger, "task trigger"),
      );
      valid.push(row);
    } catch (err) {
      if (options.throwOnError) throw err;
      failed += 1;
      logFailure(row.id, err);
    }
  }
  if (valid.length === 0) return { evaluated: 0, failed };
  const batch = await buildBatch(ctx, valid, triggers);
  let evaluated = 0;
  for (const row of valid) {
    try {
      writeState(ctx, row, triggers.get(row.id) as Trigger, batch);
      evaluated += 1;
    } catch (err) {
      if (options.throwOnError) throw err;
      failed += 1;
      logFailure(row.id, err);
    }
  }
  return { evaluated, failed };
}

function logFailure(taskId: string, err: unknown): void {
  // Ids and error names only: titles and trigger contents are household data.
  console.error(
    JSON.stringify({
      event: "tasks.evaluate_failed",
      taskId,
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
}

/** Re-evaluates one task (also archived ones, when asked for explicitly) and stores the verdict. */
export async function evaluateTaskById(
  ctx: ServiceContext,
  taskId: string,
): Promise<TaskStateRecord | null> {
  const row = ctx.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) return null;
  await evaluateRows(ctx, [row], { throwOnError: true });
  const state = ctx.db
    .select()
    .from(taskState)
    .where(eq(taskState.taskId, taskId))
    .get();
  return state ? toStateRecord(state) : null;
}

/** Re-evaluates every active task. One broken task is logged and skipped, never fatal. */
export async function evaluateAll(
  ctx: ServiceContext,
): Promise<EvaluationSummary> {
  const rows = ctx.db
    .select()
    .from(tasks)
    .where(isNull(tasks.archivedAt))
    .all();
  return evaluateRows(ctx, rows, { throwOnError: false });
}
