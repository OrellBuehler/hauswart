import { sql, type AnyColumn } from "drizzle-orm";
import type { CommentEntityType } from "$lib/api/enums";

/**
 * Number of (not deleted) comments on the entity whose id column is given, as
 * a correlated subquery for a select list; it adds no join and no grouping.
 */
export function commentCountSql(type: CommentEntityType, idColumn: AnyColumn) {
  return sql<number>`(select count(*) from comments where comments.entity_type = ${type} and comments.entity_id = ${idColumn} and comments.deleted_at is null)`;
}
