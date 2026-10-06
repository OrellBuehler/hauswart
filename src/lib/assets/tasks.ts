import type { Asset } from "$lib/api/schemas/assets";
import type { Task } from "$lib/api/schemas/tasks";

const STATUS_RANK = {
  overdue: 0,
  due: 1,
  open: 2,
  ok: 3,
  unknown: 4,
  snoozed: 5,
} as const;

/** Tasks the household has to act on: overdue, due or open. */
export function isActionable(task: Task): boolean {
  const status = task.state?.status;
  return status === "overdue" || status === "due" || status === "open";
}

/** Most urgent first, then by due date; tasks without a date last. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byStatus =
      STATUS_RANK[a.state?.status ?? "unknown"] -
      STATUS_RANK[b.state?.status ?? "unknown"];
    if (byStatus !== 0) return byStatus;
    const dateA = a.state?.dueDate ?? "9999-12-31";
    const dateB = b.state?.dueDate ?? "9999-12-31";
    return dateA < dateB
      ? -1
      : dateA > dateB
        ? 1
        : a.title.localeCompare(b.title);
  });
}

/** A task belongs to its own room, or else to the room of its asset (as on the dashboard). */
export function taskRoomId(
  task: Task,
  assetRooms: ReadonlyMap<string, string | null>,
): string | null {
  return (
    task.roomId ??
    (task.assetId ? (assetRooms.get(task.assetId) ?? null) : null)
  );
}

export type RoomStats = { assets: number; actionable: number; overdue: number };

/** Counts per room id, from one list of assets and one of tasks. */
export function roomStats(
  assets: Pick<Asset, "id" | "roomId">[],
  tasks: Task[],
): Map<string, RoomStats> {
  const stats = new Map<string, RoomStats>();
  const entry = (roomId: string) => {
    let value = stats.get(roomId);
    if (!value) {
      value = { assets: 0, actionable: 0, overdue: 0 };
      stats.set(roomId, value);
    }
    return value;
  };
  const assetRooms = new Map(assets.map((a) => [a.id, a.roomId]));
  for (const asset of assets) {
    if (asset.roomId) entry(asset.roomId).assets++;
  }
  for (const task of tasks) {
    const roomId = taskRoomId(task, assetRooms);
    if (!roomId || !isActionable(task)) continue;
    const value = entry(roomId);
    value.actionable++;
    if (task.state?.status === "overdue") value.overdue++;
  }
  return stats;
}
