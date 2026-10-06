import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { addDays, diffDays } from "$lib/dates";
import { computeStats, type CompletionStats } from "$lib/tasks/engine";
import { taskCompletions, tasks } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";
import { clockAt } from "./evaluator";

export const DEFAULT_STATS_DAYS = 90;
export const MAX_STATS_DAYS = 800;

export interface StatsRecord extends CompletionStats {
  from: string;
  to: string;
}

/** Completions per person and category over a range of completion dates (default: the last 90 days). */
export function getStats(
  ctx: ServiceContext,
  range: { from?: string; to?: string },
): StatsRecord {
  const to = range.to ?? clockAt(ctx.now).today;
  const from = range.from ?? addDays(to, -(DEFAULT_STATS_DAYS - 1));
  if (from > to) throw invalidField("from", "Must not be after to", "query");
  if (diffDays(to, from) >= MAX_STATS_DAYS) {
    throw invalidField(
      "from",
      `The range may span at most ${MAX_STATS_DAYS} days`,
      "query",
    );
  }
  const rows = ctx.db
    .select({
      userId: taskCompletions.userId,
      kind: taskCompletions.kind,
      completedDate: taskCompletions.completedDate,
      dueDateAtCompletion: taskCompletions.dueDateAtCompletion,
      category: tasks.category,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        isNull(taskCompletions.revokedAt),
        gte(taskCompletions.completedDate, from),
        lte(taskCompletions.completedDate, to),
      ),
    )
    .all();
  return { from, to, ...computeStats(rows) };
}
