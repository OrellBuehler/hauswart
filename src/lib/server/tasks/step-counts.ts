import { sql, type AnyColumn } from "drizzle-orm";

/**
 * Number of steps of the task whose id column is given, as a correlated subquery for a select list;
 * it adds no join and no grouping.
 */
export function stepCountSql(taskIdColumn: AnyColumn) {
  return sql<number>`(select count(*) from task_steps where task_steps.task_id = ${taskIdColumn})`;
}

/** Whether the task whose id column is given has at least one step, for a `where`. */
export function hasStepsSql(taskIdColumn: AnyColumn) {
  return sql<boolean>`exists (select 1 from task_steps where task_steps.task_id = ${taskIdColumn})`;
}
