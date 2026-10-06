import { sql, type AnyColumn } from "drizzle-orm";

/**
 * What the booked costs of a defect or service log entry add up to, as
 * correlated subqueries for a select list (no join, no grouping): the sum of
 * the entries in the household currency and their number. Refunds net off.
 */
export function costsOfSql(
  by: "defect_id" | "service_log_id",
  idColumn: AnyColumn,
) {
  const column = sql.raw(`cost_entries.${by}`);
  const currency = sql`coalesce((select currency from household limit 1), 'CHF')`;
  return {
    total: sql<number>`(select coalesce(sum(amount_minor), 0) from cost_entries where ${column} = ${idColumn} and currency = ${currency})`,
    count: sql<number>`(select count(*) from cost_entries where ${column} = ${idColumn})`,
  };
}

export interface CostsOf {
  totalMinor: number;
  count: number;
}
