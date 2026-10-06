import { and, asc, eq, inArray } from "drizzle-orm";
import { prepState, type PrepConfig, type PrepState } from "$lib/tasks/engine";
import type {
  CreatePreparationRequest,
  LeadValue,
  UpdatePreparationRequest,
} from "$lib/api/schemas/tasks";
import { leadValueSchema } from "$lib/api/schemas/tasks";
import { parts, taskPrepCompletions, taskPreparations } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { clockAt, evaluateTaskById } from "./evaluator";
import { signalNeedsChanged } from "$lib/server/signals/watch";
import { loadSignals } from "./signals";
import { stateToDue, type TaskStateRecord } from "./state";
import { getTask } from "./tasks";

type PrepRow = typeof taskPreparations.$inferSelect;

export interface PreparationRecord extends Omit<PrepRow, "leadValue"> {
  leadValue: LeadValue | null;
  /** Relative to the task's current occurrence. */
  state: PrepState;
}

type Db = Pick<ServiceContext, "db">;

function leadValueOf(row: PrepRow): LeadValue | null {
  return row.leadValue === null
    ? null
    : parseStored(leadValueSchema, row.leadValue, "preparation lead value");
}

/**
 * Preparation states for many tasks at once, keyed by task id. A task without a
 * cached verdict has no states yet (it is evaluated on creation, so this is a
 * transient gap, not a normal case).
 */
export async function preparationsForTasks(
  ctx: ServiceContext,
  states: ReadonlyMap<string, TaskStateRecord>,
): Promise<Map<string, PreparationRecord[]>> {
  const result = new Map<string, PreparationRecord[]>();
  const taskIds = [...states.keys()];
  if (taskIds.length === 0) return result;

  const rows: PrepRow[] = [];
  const completed = new Map<string, string[]>();
  for (let i = 0; i < taskIds.length; i += 500) {
    const chunk = taskIds.slice(i, i + 500);
    rows.push(
      ...ctx.db
        .select()
        .from(taskPreparations)
        .where(inArray(taskPreparations.taskId, chunk))
        .orderBy(
          asc(taskPreparations.sortOrder),
          asc(taskPreparations.createdAt),
          asc(taskPreparations.id),
        )
        .all(),
    );
  }
  const prepIds = rows.map((r) => r.id);
  for (let i = 0; i < prepIds.length; i += 500) {
    for (const c of ctx.db
      .select()
      .from(taskPrepCompletions)
      .where(inArray(taskPrepCompletions.prepId, prepIds.slice(i, i + 500)))
      .all()) {
      completed.set(c.prepId, [
        ...(completed.get(c.prepId) ?? []),
        c.occurrenceKey,
      ]);
    }
  }

  const stock = partStock(
    ctx,
    rows.flatMap((r) =>
      r.kind === "order_part" && r.partId ? [r.partId] : [],
    ),
  );
  const records = rows.map((row) => ({ row, leadValue: leadValueOf(row) }));
  const signals = await loadSignals(
    ctx.db,
    {
      entityIds: [
        ...new Set(
          records.flatMap((r) => (r.leadValue ? [r.leadValue.entityId] : [])),
        ),
      ],
      calendars: [],
    },
    ctx.now,
  );
  const { today } = clockAt(ctx.now);

  for (const { row, leadValue } of records) {
    const state = states.get(row.taskId);
    if (!state) continue;
    const config: PrepConfig = {
      kind: row.kind,
      qty: row.qty,
      ...(row.partId !== null && stock.has(row.partId)
        ? { partStock: stock.get(row.partId) }
        : {}),
      ...(row.leadDays === null ? {} : { leadDays: row.leadDays }),
      ...(leadValue ? { leadValue } : {}),
    };
    const list = result.get(row.taskId) ?? [];
    list.push({
      ...row,
      leadValue,
      state: prepState({
        due: stateToDue(state),
        prep: config,
        prepCompletions: completed.get(row.id) ?? [],
        signals: signals.signals,
        today,
      }),
    });
    result.set(row.taskId, list);
  }
  return result;
}

/** Stock counts by part id; an order-part preparation is skipped while stock covers its quantity. */
function partStock(ctx: Db, ids: string[]): Map<string, number> {
  const result = new Map<string, number>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    for (const row of ctx.db
      .select({ id: parts.id, stock: parts.stockCount })
      .from(parts)
      .where(inArray(parts.id, unique.slice(i, i + 500)))
      .all()) {
      result.set(row.id, row.stock);
    }
  }
  return result;
}

function assertPart(ctx: Db, partId: string | null | undefined) {
  if (!partId) return;
  const hit = ctx.db
    .select({ id: parts.id })
    .from(parts)
    .where(eq(parts.id, partId))
    .get();
  if (!hit) throw invalidField("partId", "Part does not exist");
}

export async function listPreparations(
  ctx: ServiceContext,
  taskId: string,
): Promise<PreparationRecord[]> {
  const task = getTask(ctx, taskId);
  const state = task.state ?? (await evaluateTaskById(ctx, taskId));
  if (!state) return [];
  const all = await preparationsForTasks(ctx, new Map([[taskId, state]]));
  return all.get(taskId) ?? [];
}

async function recordOf(
  ctx: ServiceContext,
  taskId: string,
  prepId: string,
): Promise<PreparationRecord> {
  const found = (await listPreparations(ctx, taskId)).find(
    (p) => p.id === prepId,
  );
  if (!found) throw notFound("Preparation");
  return found;
}

function findPrep(ctx: Db, taskId: string, prepId: string): PrepRow {
  const row = ctx.db
    .select()
    .from(taskPreparations)
    .where(
      and(eq(taskPreparations.id, prepId), eq(taskPreparations.taskId, taskId)),
    )
    .get();
  if (!row) throw notFound("Preparation");
  return row;
}

export async function createPreparation(
  ctx: ServiceContext,
  taskId: string,
  input: CreatePreparationRequest,
): Promise<PreparationRecord> {
  getTask(ctx, taskId);
  assertPart(ctx, input.partId);
  const row = ctx.db
    .insert(taskPreparations)
    .values({
      taskId,
      title: input.title,
      kind: input.kind,
      leadDays: input.leadDays ?? null,
      leadValue: input.leadValue ?? null,
      partId: input.partId ?? null,
      qty: input.qty,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({ id: taskPreparations.id })
    .get();
  if (input.leadValue) signalNeedsChanged(ctx);
  return recordOf(ctx, taskId, row.id);
}

export async function updatePreparation(
  ctx: ServiceContext,
  taskId: string,
  prepId: string,
  patch: UpdatePreparationRequest,
): Promise<PreparationRecord> {
  findPrep(ctx, taskId, prepId);
  assertPart(ctx, patch.partId);
  ctx.db
    .update(taskPreparations)
    .set(patch)
    .where(eq(taskPreparations.id, prepId))
    .run();
  if (patch.leadValue) signalNeedsChanged(ctx);
  return recordOf(ctx, taskId, prepId);
}

export function deletePreparation(
  ctx: Db,
  taskId: string,
  prepId: string,
): void {
  findPrep(ctx, taskId, prepId);
  ctx.db.delete(taskPreparations).where(eq(taskPreparations.id, prepId)).run();
}

/**
 * Ticks a preparation off for one occurrence (default: the one the task shows
 * now). Doing it twice is not an error; the first tick stays.
 */
export async function completePreparation(
  ctx: ServiceContext,
  taskId: string,
  prepId: string,
  input: { userId: string | null; occurrenceKey?: string },
): Promise<PreparationRecord> {
  findPrep(ctx, taskId, prepId);
  const task = getTask(ctx, taskId);
  const state = task.state ?? (await evaluateTaskById(ctx, taskId));
  const occurrenceKey = input.occurrenceKey ?? state?.occurrenceKey;
  if (!occurrenceKey) throw notFound("Occurrence");
  ctx.db
    .insert(taskPrepCompletions)
    .values({
      prepId,
      occurrenceKey,
      userId: input.userId,
      completedAt: new Date(ctx.now),
    })
    .onConflictDoNothing()
    .run();
  return recordOf(ctx, taskId, prepId);
}
