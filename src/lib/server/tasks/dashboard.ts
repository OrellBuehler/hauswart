import { eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  buildUpcoming,
  type UpcomingInput,
  type UpcomingItem,
} from "$lib/tasks/engine";
import {
  DASHBOARD_HORIZON_DAYS,
  DASHBOARD_RECENT_COMPLETIONS,
} from "$lib/api/schemas/dashboard";
import { assets, rooms, taskState, tasks, users } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { recentCompletions, type CompletionRecord } from "./completions";
import { clockAt } from "./evaluator";
import { preparationsForTasks } from "./preparations";
import { toStateRecord, type TaskStateRecord } from "./state";
import type { TaskRow } from "./tasks";

export interface DashboardTaskRecord {
  taskId: string;
  title: string;
  category: TaskRow["category"];
  priority: TaskRow["priority"];
  assetId: string | null;
  assetName: string | null;
  roomId: string | null;
  roomName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  status: TaskStateRecord["status"];
  dueKind: TaskStateRecord["dueKind"];
  date: string | null;
  estimated: boolean;
  estimate: TaskStateRecord["estimate"];
  progress: TaskStateRecord["progress"];
}

export interface DashboardPreparationRecord {
  taskId: string;
  taskTitle: string;
  prepId: string;
  title: string;
  state: "now";
  date: string | null;
}

export interface DashboardRecord {
  today: string;
  generatedAt: Date;
  counts: {
    overdue: number;
    today: number;
    thisWeek: number;
    preparations: number;
  };
  upcoming: {
    overdue: DashboardTaskRecord[];
    today: DashboardTaskRecord[];
    thisWeek: DashboardTaskRecord[];
    later: DashboardTaskRecord[];
    signalBased: DashboardTaskRecord[];
  };
  preparations: DashboardPreparationRecord[];
  recentCompletions: CompletionRecord[];
}

/**
 * Everything the start page shows, from the cached verdicts: what is overdue,
 * due today, this week and later (60 days), signal-based tasks, preparations
 * that have become relevant, and the last completions. Defects, warranties
 * and parts to order are added by the dashboard handler from their own services.
 */
export async function getDashboard(
  ctx: ServiceContext,
): Promise<DashboardRecord> {
  const { today } = clockAt(ctx.now);
  const assetRoom = alias(rooms, "asset_room");
  const rows = ctx.db
    .select({
      task: tasks,
      state: taskState,
      assetName: assets.name,
      roomId: assets.roomId,
      ownRoomName: rooms.name,
      assetRoomName: assetRoom.name,
    })
    .from(tasks)
    .innerJoin(taskState, eq(taskState.taskId, tasks.id))
    .leftJoin(assets, eq(assets.id, tasks.assetId))
    .leftJoin(rooms, eq(rooms.id, tasks.roomId))
    .leftJoin(assetRoom, eq(assetRoom.id, assets.roomId))
    .where(isNull(tasks.archivedAt))
    .all();

  const people = new Map(
    ctx.db
      .select({
        id: users.id,
        name: users.displayName,
        username: users.username,
      })
      .from(users)
      .all()
      .map((u) => [u.id, u.name ?? u.username]),
  );

  const byTask = new Map(
    rows.map((r) => [r.task.id, { ...r, state: toStateRecord(r.state) }]),
  );
  const awake = new Map(
    [...byTask]
      .filter(([, r]) => !(r.task.snoozedUntil && r.task.snoozedUntil > today))
      .map(([id, r]) => [id, r.state]),
  );
  const preps = await preparationsForTasks(ctx, awake);

  const inputs: UpcomingInput[] = [...byTask.values()].map((r) => ({
    taskId: r.task.id,
    title: r.task.title,
    due: {
      status: r.state.status,
      dueDate: r.state.dueDate,
      dueKind: r.state.dueKind,
      occurrenceKey: r.state.occurrenceKey,
      reasons: r.state.reasons,
      ...(r.state.estimate ? { estimate: r.state.estimate } : {}),
      ...(r.state.progress ? { progress: r.state.progress } : {}),
    },
    preps: (preps.get(r.task.id) ?? []).map((p) => ({
      id: p.id,
      label: p.title,
      state: p.state,
    })),
  }));
  const upcoming = buildUpcoming(inputs, today, DASHBOARD_HORIZON_DAYS);

  const enrich = (item: UpcomingItem): DashboardTaskRecord => {
    const r = byTask.get(item.taskId)!;
    const assignee = r.state.currentAssigneeUserId;
    return {
      taskId: r.task.id,
      title: r.task.title,
      category: r.task.category,
      priority: r.task.priority,
      assetId: r.task.assetId,
      assetName: r.assetName,
      roomId: r.task.roomId ?? r.roomId,
      roomName: r.ownRoomName ?? r.assetRoomName,
      assigneeUserId: assignee,
      assigneeName: assignee ? (people.get(assignee) ?? null) : null,
      status: item.due.status,
      dueKind: item.due.dueKind,
      date: item.date,
      estimated: item.estimated,
      estimate: item.due.estimate ?? null,
      progress: item.due.progress ?? null,
    };
  };

  const preparations: DashboardPreparationRecord[] = upcoming.preparations.map(
    (p) => ({
      taskId: p.taskId,
      taskTitle: p.title,
      prepId: p.prepId,
      title: p.label ?? "",
      state: "now",
      date: p.date,
    }),
  );

  return {
    today,
    generatedAt: new Date(ctx.now),
    counts: {
      overdue: upcoming.overdue.length,
      today: upcoming.today.length,
      thisWeek: upcoming.thisWeek.length,
      preparations: preparations.length,
    },
    upcoming: {
      overdue: upcoming.overdue.map(enrich),
      today: upcoming.today.map(enrich),
      thisWeek: upcoming.thisWeek.map(enrich),
      later: upcoming.later.map(enrich),
      signalBased: upcoming.signalBased.map(enrich),
    },
    preparations,
    recentCompletions: recentCompletions(ctx, DASHBOARD_RECENT_COMPLETIONS),
  };
}
