import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DueStatus } from "$lib/tasks/engine";
import { evaluateTask, triggerSchema, type Trigger } from "$lib/tasks/engine";
import { zonedTimeToInstant } from "$lib/dates";
import type { TaskCategory } from "$lib/api/enums";
import type {
  CreateTaskRequest,
  UpdateTaskRequest,
} from "$lib/api/schemas/tasks";
import { assets, rooms, taskState, tasks, users } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import { getHousehold } from "$lib/server/household/household";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { clockAt, evaluateTaskById } from "./evaluator";
import { toStateRecord, type StateRow, type TaskStateRecord } from "./state";
import type { DueResult } from "$lib/tasks/engine";

export type TaskRow = typeof tasks.$inferSelect;

export interface TaskRecord extends Omit<TaskRow, "trigger"> {
  trigger: Trigger;
  assetName: string | null;
  roomName: string | null;
  state: TaskStateRecord | null;
}

type Joined = {
  task: TaskRow;
  assetName: string | null;
  roomName: string | null;
  state: StateRow | null;
};

const selectTasks = (db: ServiceContext["db"]) =>
  db
    .select({
      task: tasks,
      assetName: assets.name,
      roomName: rooms.name,
      state: taskState,
    })
    .from(tasks)
    .leftJoin(assets, eq(tasks.assetId, assets.id))
    .leftJoin(rooms, eq(tasks.roomId, rooms.id))
    .leftJoin(taskState, eq(taskState.taskId, tasks.id));

function toRecord({ task, assetName, roomName, state }: Joined): TaskRecord {
  return {
    ...task,
    trigger: parseStored(triggerSchema, task.trigger, "task trigger"),
    assetName,
    roomName,
    state: state ? toStateRecord(state) : null,
  };
}

export interface TaskFilter {
  status?: DueStatus;
  category?: TaskCategory;
  assetId?: string;
  roomId?: string;
  /** `me` or a user id. */
  assignee?: string;
  q?: string;
  includeArchived?: boolean;
  externalSource?: string;
  externalRef?: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Overdue first, then by due date; tasks without a date (signal-based) last.
const STATUS_RANK: Record<DueStatus, number> = {
  overdue: 0,
  due: 1,
  open: 2,
  ok: 3,
  unknown: 4,
  snoozed: 5,
};

function compareTasks(a: TaskRecord, b: TaskRecord): number {
  const dateA = a.state?.dueDate ?? a.state?.estimate?.date ?? "9999-12-31";
  const dateB = b.state?.dueDate ?? b.state?.estimate?.date ?? "9999-12-31";
  return (
    STATUS_RANK[a.state?.status ?? "unknown"] -
      STATUS_RANK[b.state?.status ?? "unknown"] ||
    (dateA < dateB ? -1 : dateA > dateB ? 1 : 0) ||
    a.title.localeCompare(b.title, "de") ||
    (a.id < b.id ? -1 : 1)
  );
}

export function listTasks(
  ctx: Pick<ServiceContext, "db">,
  filter: TaskFilter,
  page: { cursor?: string; limit: number },
  viewerId: string,
) {
  const where: SQL[] = [];
  if (!filter.includeArchived) where.push(isNull(tasks.archivedAt));
  if (filter.category) where.push(eq(tasks.category, filter.category));
  if (filter.assetId) where.push(eq(tasks.assetId, filter.assetId));
  if (filter.roomId) where.push(eq(tasks.roomId, filter.roomId));
  if (filter.status) where.push(eq(taskState.status, filter.status));
  if (filter.assignee) {
    where.push(
      eq(
        taskState.currentAssigneeUserId,
        filter.assignee === "me" ? viewerId : filter.assignee,
      ),
    );
  }
  if (filter.externalSource) {
    where.push(eq(tasks.externalSource, filter.externalSource));
  }
  if (filter.externalRef) where.push(eq(tasks.externalRef, filter.externalRef));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    where.push(
      or(
        sql`lower(${tasks.title}) like ${pattern} escape '\\'`,
        sql`lower(${tasks.descriptionMd}) like ${pattern} escape '\\'`,
      ) as SQL,
    );
  }
  const rows = selectTasks(ctx.db)
    .where(and(...where))
    .all()
    .map(toRecord)
    .sort(compareTasks);
  return paginateArray(rows, page.cursor, page.limit);
}

export function findTask(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): TaskRecord | undefined {
  const row = selectTasks(ctx.db).where(eq(tasks.id, id)).get();
  return row && toRecord(row);
}

export function getTask(
  ctx: Pick<ServiceContext, "db">,
  id: string,
): TaskRecord {
  const task = findTask(ctx, id);
  if (!task) throw notFound("Task");
  return task;
}

function assertExists(
  ctx: Pick<ServiceContext, "db">,
  table: typeof assets | typeof rooms,
  id: string | null | undefined,
  field: string,
  label: string,
) {
  if (!id) return;
  const hit = ctx.db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id))
    .get();
  if (!hit) throw invalidField(field, `${label} does not exist`);
}

interface Assignment {
  assignMode: TaskRow["assignMode"];
  assigneeUserId: string | null;
  rotationOrder: string[];
}

/**
 * The assignment fields must agree with the mode: "fixed" needs a user,
 * "rotate" needs at least one; fields of the other modes are cleared so a stale
 * assignee never lingers.
 */
function normalizeAssignment(
  ctx: Pick<ServiceContext, "db">,
  value: Assignment,
): Assignment {
  const known = (ids: string[]) => {
    if (ids.length === 0) return;
    const found = new Set(
      ctx.db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, ids))
        .all()
        .map((u) => u.id),
    );
    const missing = ids.find((id) => !found.has(id));
    return missing;
  };
  if (value.assignMode === "none") {
    return { assignMode: "none", assigneeUserId: null, rotationOrder: [] };
  }
  if (value.assignMode === "fixed") {
    if (!value.assigneeUserId) {
      throw invalidField("assigneeUserId", "Required when assignMode is fixed");
    }
    if (known([value.assigneeUserId]) !== undefined) {
      throw invalidField("assigneeUserId", "User does not exist");
    }
    return { ...value, rotationOrder: [] };
  }
  const order = [...new Set(value.rotationOrder)];
  if (order.length === 0) {
    throw invalidField(
      "rotationOrder",
      "Needs at least one user when assignMode is rotate",
    );
  }
  if (known(order) !== undefined) {
    throw invalidField("rotationOrder", "User does not exist");
  }
  return { assignMode: "rotate", assigneeUserId: null, rotationOrder: order };
}

export async function createTask(
  ctx: ServiceContext,
  input: CreateTaskRequest,
  createdBy: string | null,
): Promise<TaskRecord> {
  assertExists(ctx, assets, input.assetId, "assetId", "Asset");
  assertExists(ctx, rooms, input.roomId, "roomId", "Room");
  const assignment = normalizeAssignment(ctx, {
    assignMode: input.assignMode,
    assigneeUserId: input.assigneeUserId ?? null,
    rotationOrder: input.rotationOrder,
  });
  let id: string;
  try {
    id = ctx.db
      .insert(tasks)
      .values({
        title: input.title,
        descriptionMd: input.descriptionMd,
        category: input.category,
        priority: input.priority,
        effortMinutes: input.effortMinutes ?? null,
        assetId: input.assetId ?? null,
        roomId: input.roomId ?? null,
        trigger: input.trigger,
        ...assignment,
        rotationStrategy: input.rotationStrategy,
        notifyMode: input.notifyMode,
        graceDays: input.graceDays,
        dueSoonDays: input.dueSoonDays ?? null,
        source: input.source,
        externalSource: input.externalSource ?? null,
        externalRef: input.externalRef ?? null,
        externalUrl: input.externalUrl ?? null,
        createdBy,
      })
      .returning({ id: tasks.id })
      .get().id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict("A task with this external reference already exists");
    }
    throw err;
  }
  await evaluateTaskById(ctx, id);
  return getTask(ctx, id);
}

export async function updateTask(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTaskRequest,
): Promise<TaskRecord> {
  const current = getTask(ctx, id);
  if (patch.assetId !== undefined) {
    assertExists(ctx, assets, patch.assetId, "assetId", "Asset");
  }
  if (patch.roomId !== undefined) {
    assertExists(ctx, rooms, patch.roomId, "roomId", "Room");
  }
  const touchesAssignment =
    patch.assignMode !== undefined ||
    patch.assigneeUserId !== undefined ||
    patch.rotationOrder !== undefined;
  const assignment = touchesAssignment
    ? normalizeAssignment(ctx, {
        assignMode: patch.assignMode ?? current.assignMode,
        assigneeUserId:
          patch.assigneeUserId !== undefined
            ? patch.assigneeUserId
            : current.assigneeUserId,
        rotationOrder: patch.rotationOrder ?? current.rotationOrder,
      })
    : {};
  const { archived, ...fields } = patch;
  ctx.db
    .update(tasks)
    .set({
      ...fields,
      ...assignment,
      ...(archived === undefined
        ? {}
        : {
            archivedAt: archived
              ? (current.archivedAt ?? new Date(ctx.now))
              : null,
          }),
    })
    .where(eq(tasks.id, id))
    .run();
  await evaluateTaskById(ctx, id);
  return getTask(ctx, id);
}

/** Removes the task with its state, completions, preparations, notifications and attachments. Archive to keep the history. */
export function deleteTask(
  ctx: Pick<ServiceContext, "db" | "now">,
  id: string,
): void {
  const result = ctx.db
    .delete(tasks)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id })
    .all();
  if (result.length === 0) throw notFound("Task");
  removeOwnedAttachments(ctx, "task", id);
}

export interface PreviewOptions {
  today?: string;
  graceDays?: number;
  dueSoonDays?: number;
}

/** What the engine says about a trigger that has never been completed; nothing is stored. */
export function previewTrigger(
  ctx: ServiceContext,
  trigger: Trigger,
  options: PreviewOptions = {},
): DueResult {
  const clock = clockAt(ctx.now);
  const today = options.today ?? clock.today;
  const now =
    options.today === undefined
      ? clock.now
      : zonedTimeToInstant(today, "12:00", clock.tz);
  return evaluateTask({
    trigger,
    completions: [],
    today,
    now,
    tz: clock.tz,
    graceDays: options.graceDays,
    dueSoonDays: options.dueSoonDays ?? getHousehold(ctx).settings.dueSoonDays,
  });
}
