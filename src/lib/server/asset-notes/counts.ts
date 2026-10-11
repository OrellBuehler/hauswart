import { sql, type AnyColumn } from "drizzle-orm";

/**
 * Number of open notes on the asset whose id column is given, as a correlated subquery for a select
 * list (0 when the column is null); it adds no join and no grouping.
 */
export function openNoteCountSql(assetIdColumn: AnyColumn) {
  return sql<number>`(select count(*) from asset_notes where asset_notes.asset_id = ${assetIdColumn} and asset_notes.status = 'open')`;
}
