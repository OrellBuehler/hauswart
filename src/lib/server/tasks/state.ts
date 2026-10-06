import { z } from "zod";
import { DUE_REASONS } from "$lib/api/enums";
import { parseStored } from "$lib/server/json";
import { taskState } from "$lib/server/db";
import type {
  DueKind,
  DueResult,
  DueStatus,
  Estimate,
  Reason,
} from "$lib/tasks/engine";

export type StateRow = typeof taskState.$inferSelect;

export interface TaskStateRecord {
  taskId: string;
  status: DueStatus;
  dueDate: string | null;
  dueKind: DueKind;
  occurrenceKey: string;
  windowStart: string | null;
  progress: { current: number; target: number; unit?: string } | null;
  estimate: Estimate | null;
  missedCount: number;
  reasons: Reason[];
  currentAssigneeUserId: string | null;
  counterBaseline: number | null;
  activeSince: number | null;
  dueSince: number | null;
  evaluatedAt: Date;
}

const reasonsSchema = z.array(z.enum(DUE_REASONS));

export function toStateRecord(row: StateRow): TaskStateRecord {
  return {
    taskId: row.taskId,
    status: row.status,
    dueDate: row.dueDate,
    dueKind: row.dueKind,
    occurrenceKey: row.occurrenceKey,
    windowStart: row.windowStart,
    progress: row.progressJson ?? null,
    estimate: row.estimateJson ?? null,
    missedCount: row.missedCount,
    reasons: parseStored(reasonsSchema, row.reasonsJson, "task state reasons"),
    currentAssigneeUserId: row.currentAssigneeUserId,
    counterBaseline: row.counterBaseline,
    activeSince: row.activeSince,
    dueSince: row.dueSince,
    evaluatedAt: row.evaluatedAt,
  };
}

/** The cached verdict as the engine's own type again (for `buildUpcoming` and `prepState`). */
export function stateToDue(state: TaskStateRecord): DueResult {
  return {
    status: state.status,
    dueDate: state.dueDate,
    dueKind: state.dueKind,
    occurrenceKey: state.occurrenceKey,
    reasons: state.reasons,
    ...(state.windowStart ? { windowStart: state.windowStart } : {}),
    ...(state.progress ? { progress: state.progress } : {}),
    ...(state.estimate ? { estimate: state.estimate } : {}),
    ...(state.missedCount > 0 ? { missedCount: state.missedCount } : {}),
  };
}
