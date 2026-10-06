import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { CompletionKind, CompletionSource } from "$lib/api/enums";
import { UNDO_WINDOW_DAYS } from "$lib/api/schemas/tasks";
import { taskCompletions, tasks, users, type DB } from "$lib/server/db";
import { emitEvent, type CompletionFacts } from "$lib/server/events";
import { decodeCursor, pageOf } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { z } from "zod";
import { clockAt, evaluateTaskById } from "./evaluator";
import { getTask, type TaskRecord } from "./tasks";

export type CompletionRow = typeof taskCompletions.$inferSelect;

export interface CompletionRecord extends CompletionRow {
  taskTitle: string;
  userName: string | null;
}

const selectCompletions = (db: ServiceContext["db"]) =>
  db
    .select({
      completion: taskCompletions,
      taskTitle: tasks.title,
      userName: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .leftJoin(users, eq(users.id, taskCompletions.userId));

type Joined = {
  completion: CompletionRow;
  taskTitle: string;
  userName: string | null;
};
const toRecord = ({
  completion,
  taskTitle,
  userName,
}: Joined): CompletionRecord => ({
  ...completion,
  taskTitle,
  userName,
});

export function getCompletion(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): CompletionRecord {
  const row = selectCompletions(ctx.db).where(eq(taskCompletions.id, id)).get();
  if (!row) throw notFound("Completion");
  return toRecord(row);
}

const factsOf = (row: CompletionRow): CompletionFacts => ({
  id: row.id,
  taskId: row.taskId,
  kind: row.kind,
  userId: row.userId,
  completedAt: row.completedAt,
});

/** The newest non-revoked completions of one task. */
export function recentCompletionsOf(
  ctx: Pick<ServiceContext, "db">,
  taskId: string,
  limit: number,
): CompletionRecord[] {
  return selectCompletions(ctx.db)
    .where(
      and(
        eq(taskCompletions.taskId, taskId),
        isNull(taskCompletions.revokedAt),
      ),
    )
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id))
    .limit(limit)
    .all()
    .map(toRecord);
}

export function recentCompletions(
  ctx: Pick<ServiceContext, "db">,
  limit: number,
): CompletionRecord[] {
  return selectCompletions(ctx.db)
    .where(isNull(taskCompletions.revokedAt))
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id))
    .limit(limit)
    .all()
    .map(toRecord);
}

const cursorSchema = z.object({ t: z.number().int(), id: z.string() });

export interface CompletionFilter {
  taskId?: string;
  userId?: string;
  includeRevoked?: boolean;
}

/** Newest first; keyset pages on (completedAt, id), so rows added meanwhile never shift a page. */
export function listCompletions(
  ctx: Pick<ServiceContext, "db">,
  filter: CompletionFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (!filter.includeRevoked) where.push(isNull(taskCompletions.revokedAt));
  if (filter.taskId) where.push(eq(taskCompletions.taskId, filter.taskId));
  if (filter.userId) where.push(eq(taskCompletions.userId, filter.userId));
  if (page.cursor) {
    const at = decodeCursor(page.cursor, cursorSchema);
    where.push(
      or(
        lt(taskCompletions.completedAt, new Date(at.t)),
        and(
          eq(taskCompletions.completedAt, new Date(at.t)),
          lt(taskCompletions.id, at.id),
        ),
      ) as SQL,
    );
  }
  const rows = selectCompletions(ctx.db)
    .where(and(...where))
    .orderBy(desc(taskCompletions.completedAt), desc(taskCompletions.id))
    .limit(page.limit + 1)
    .all()
    .map(toRecord);
  return pageOf(rows, page.limit, (row) => ({
    t: row.completedAt.getTime(),
    id: row.id,
  }));
}

export interface CompleteInput {
  kind: CompletionKind;
  source: CompletionSource;
  userId: string | null;
  note?: string | null;
  /** Defaults to the occurrence the task currently shows. */
  occurrenceKey?: string;
  /** ms since epoch; defaults to now. */
  completedAt?: number;
  idempotencyKey?: string;
  counterValue?: number;
}

export interface CompleteResult {
  completion: CompletionRecord;
  task: TaskRecord;
  /** True when `idempotencyKey` matched an earlier request and nothing new was written. */
  replayed: boolean;
}

/** A client clock may run slightly ahead of the server's. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const NO_OCCURRENCE = "none";

/**
 * Records that a task was done (or deliberately skipped) and re-evaluates it
 * before returning, so the caller sees the next due date at once. With an
 * `idempotencyKey` a retried request returns the first completion unchanged.
 */
export async function completeTask(
  ctx: ServiceContext,
  taskId: string,
  input: CompleteInput,
): Promise<CompleteResult> {
  const task = getTask(ctx, taskId);
  if (task.archivedAt) throw conflict("Archived tasks cannot be completed");

  if (input.idempotencyKey) {
    const replay = findByIdempotencyKey(ctx, input.idempotencyKey, taskId);
    if (replay) return { ...replay, replayed: true };
  }

  const completedAt = input.completedAt ?? ctx.now;
  if (completedAt > ctx.now + FUTURE_TOLERANCE_MS) {
    throw invalidField("completedAt", "Must not be in the future");
  }

  const state = task.state;
  const occurrenceKey =
    input.occurrenceKey ??
    (state && state.occurrenceKey !== NO_OCCURRENCE
      ? state.occurrenceKey
      : null);
  const dueDateAtCompletion =
    state && occurrenceKey === state.occurrenceKey ? state.dueDate : null;

  let id: string;
  try {
    // Insert and reactions (stock bookings, ...) commit or roll back together.
    id = ctx.db.transaction((tx) => {
      const row = tx
        .insert(taskCompletions)
        .values({
          taskId,
          completedAt: new Date(completedAt),
          completedDate: clockAt(completedAt).today,
          userId: input.userId,
          source: input.source,
          kind: input.kind,
          counterValue: input.counterValue ?? null,
          occurrenceKey,
          dueDateAtCompletion,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: new Date(ctx.now),
        })
        .returning()
        .get();
      emitEvent("completionRecorded", {
        ctx: { ...ctx, db: tx as unknown as DB },
        completion: factsOf(row),
      });
      return row.id;
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const replay = findByIdempotencyKey(ctx, input.idempotencyKey, taskId);
      if (replay) return { ...replay, replayed: true };
    }
    throw err;
  }

  await evaluateTaskById(ctx, taskId);
  return {
    completion: getCompletion(ctx, id),
    task: getTask(ctx, taskId),
    replayed: false,
  };
}

function findByIdempotencyKey(
  ctx: ServiceContext,
  key: string,
  taskId: string,
): { completion: CompletionRecord; task: TaskRecord } | null {
  const existing = ctx.db
    .select({ id: taskCompletions.id, taskId: taskCompletions.taskId })
    .from(taskCompletions)
    .where(eq(taskCompletions.idempotencyKey, key))
    .get();
  if (!existing) return null;
  if (existing.taskId !== taskId) {
    throw conflict("This idempotency key was used for another task");
  }
  return {
    completion: getCompletion(ctx, existing.id),
    task: getTask(ctx, taskId),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Soft-revokes a completion and re-evaluates its task, which restores the
 * previous due date. Any household member may undo, within 7 days of the
 * completion being recorded. Undoing twice is not an error.
 */
export async function undoCompletion(
  ctx: ServiceContext,
  completionId: string,
  userId: string,
): Promise<void> {
  const completion = getCompletion(ctx, completionId);
  if (completion.revokedAt) return;
  if (ctx.now - completion.createdAt.getTime() > UNDO_WINDOW_DAYS * DAY_MS) {
    throw conflict(
      `Completions can only be undone within ${UNDO_WINDOW_DAYS} days`,
    );
  }
  ctx.db.transaction((tx) => {
    tx.update(taskCompletions)
      .set({ revokedAt: new Date(ctx.now), revokedBy: userId })
      .where(eq(taskCompletions.id, completionId))
      .run();
    emitEvent("completionRevoked", {
      ctx: { ...ctx, db: tx as unknown as DB },
      completion: factsOf(completion),
      revokedBy: userId,
    });
  });
  await evaluateTaskById(ctx, completion.taskId);
}

/** Hide a task until `until` (a date after today), or end the snooze with null. */
export async function snoozeTask(
  ctx: ServiceContext,
  taskId: string,
  until: string | null,
): Promise<TaskRecord> {
  getTask(ctx, taskId);
  if (until !== null && until <= clockAt(ctx.now).today) {
    throw invalidField("until", "Must be after today");
  }
  ctx.db
    .update(tasks)
    .set({ snoozedUntil: until })
    .where(eq(tasks.id, taskId))
    .run();
  await evaluateTaskById(ctx, taskId);
  return getTask(ctx, taskId);
}
