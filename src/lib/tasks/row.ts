import type { Dashboard } from "$lib/api/schemas/dashboard";
import type { Task } from "$lib/api/schemas/tasks";
import { daysUntil, formatDateShort, formatRelativeDays } from "$lib/format";
import type { DueStatus } from "./engine/types";

/** What a task row needs to render; built from a dashboard entry or a listed task. */
type DashboardTask = Dashboard["upcoming"]["today"][number];

export type TaskRowData = {
  id: string;
  title: string;
  assetId: string | null;
  assetName: string | null;
  roomId: string | null;
  roomName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  status: DueStatus;
  date: string | null;
  estimated: boolean;
  progress: {
    current: number;
    target: number;
    unit?: string | undefined;
  } | null;
  archived: boolean;
  snoozedUntil: string | null;
  commentCount?: number;
};

export function rowFromDashboard(task: DashboardTask): TaskRowData {
  return {
    id: task.taskId,
    title: task.title,
    assetId: task.assetId,
    assetName: task.assetName,
    roomId: task.roomId,
    roomName: task.roomName,
    assigneeUserId: task.assigneeUserId,
    assigneeName: task.assigneeName,
    status: task.status,
    date: task.date,
    estimated: task.estimated,
    progress: task.progress,
    archived: false,
    snoozedUntil: null,
  };
}

export type AssetPlace = { roomId: string | null; roomName: string | null };

/** A listed task; a task without its own room shows the room of its asset. */
export function rowFromTask(
  task: Task,
  people: ReadonlyMap<string, string>,
  assets: ReadonlyMap<string, AssetPlace> = new Map(),
): TaskRowData {
  const assetPlace = task.assetId ? assets.get(task.assetId) : undefined;
  const state = task.state;
  const assignee = state?.currentAssigneeUserId ?? null;
  return {
    id: task.id,
    title: task.title,
    assetId: task.assetId,
    assetName: task.assetName,
    roomId: task.roomId ?? assetPlace?.roomId ?? null,
    roomName: task.roomName ?? assetPlace?.roomName ?? null,
    assigneeUserId: assignee,
    assigneeName: assignee ? (people.get(assignee) ?? null) : null,
    status: state?.status ?? "unknown",
    date: state?.dueDate ?? state?.estimate?.date ?? null,
    estimated:
      state !== null &&
      (state.dueKind === "estimated" ||
        (state.dueDate === null && state.estimate !== null)),
    progress: state?.progress ?? null,
    archived: task.archivedAt !== null,
    snoozedUntil: task.snoozedUntil,
    commentCount: task.commentCount,
  };
}

/** Relative and absolute wording for a due date, e.g. "in 3 days" and "Sat, 10 Oct". */
export function dueWording(
  date: string,
  today: string,
): { relative: string; absolute: string; days: number } {
  const days = daysUntil(date, today);
  return {
    days,
    relative: formatRelativeDays(days),
    absolute: formatDateShort(date, { today }),
  };
}
