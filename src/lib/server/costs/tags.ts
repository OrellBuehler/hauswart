import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_COST_TAGS,
  type CostTagRef,
  type CreateCostTagRequest,
  type UpdateCostTagRequest,
} from "$lib/api/schemas/cost-tags";
import { costEntryTags, costTags, type DB } from "$lib/server/db";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type CostTagRow = typeof costTags.$inferSelect;

export interface CostTagRecord extends CostTagRow {
  entryCount: number;
}

/** Qualified by hand: drizzle leaves the table off a column in a select over one table, and `id` would then bind to the subquery's own. */
const entryCountSql = sql<number>`(select count(*) from cost_entry_tags where cost_entry_tags.tag_id = cost_tags.id)`;

const ordering = [asc(sql`lower(${costTags.name})`), asc(costTags.id)];

function select(ctx: Db) {
  return ctx.db
    .select({ tag: costTags, entryCount: entryCountSql })
    .from(costTags);
}

const recordOf = (row: {
  tag: CostTagRow;
  entryCount: number;
}): CostTagRecord => ({ ...row.tag, entryCount: Number(row.entryCount) });

/** Every tag, by name without regard to case. */
export function listCostTags(ctx: Db): CostTagRecord[] {
  return select(ctx)
    .orderBy(...ordering)
    .all()
    .map(recordOf);
}

export function getCostTag(ctx: Db, id: string): CostTagRecord {
  const row = select(ctx).where(eq(costTags.id, id)).get();
  if (!row) throw notFound("Cost tag");
  return recordOf(row);
}

/** A tag a query names; a missing one is a 404, not an empty answer. */
export function getCostTagRow(ctx: Db, id: string): CostTagRow {
  const row = ctx.db.select().from(costTags).where(eq(costTags.id, id)).get();
  if (!row) throw notFound("Cost tag");
  return row;
}

function nameTaken(ctx: Db, name: string, exceptId?: string): boolean {
  const same = sql`lower(${costTags.name}) = lower(${name})`;
  return (
    ctx.db
      .select({ id: costTags.id })
      .from(costTags)
      .where(exceptId ? sql`${same} and ${costTags.id} <> ${exceptId}` : same)
      .get() !== undefined
  );
}

const taken = () => conflict("A tag with this name already exists");

export function createCostTag(
  ctx: Db,
  input: CreateCostTagRequest,
): CostTagRecord {
  if (nameTaken(ctx, input.name)) throw taken();
  const count =
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(costTags)
      .get()?.n ?? 0;
  if (count >= MAX_COST_TAGS) {
    throw conflict(
      `There are ${MAX_COST_TAGS} tags already; delete one you do not use first`,
    );
  }
  try {
    const row = ctx.db
      .insert(costTags)
      .values({ name: input.name, color: input.color ?? "gray" })
      .returning({ id: costTags.id })
      .get();
    return getCostTag(ctx, row.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
}

export function updateCostTag(
  ctx: Db,
  id: string,
  patch: UpdateCostTagRequest,
): CostTagRecord {
  getCostTagRow(ctx, id);
  if (patch.name !== undefined && nameTaken(ctx, patch.name, id)) {
    throw taken();
  }
  try {
    ctx.db.update(costTags).set(patch).where(eq(costTags.id, id)).run();
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
  return getCostTag(ctx, id);
}

/** Deletes the tag; the entries that carried it stay, without it. */
export function deleteCostTag(ctx: Db, id: string): void {
  getCostTagRow(ctx, id);
  ctx.db.delete(costTags).where(eq(costTags.id, id)).run();
}

/** The given tag ids, each once in the order given; one that names no tag is a 400 on `field`. */
export function requireTagIds(
  ctx: Db,
  ids: readonly string[],
  field = "tagIds",
): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const known = new Set(
    ctx.db
      .select({ id: costTags.id })
      .from(costTags)
      .where(inArray(costTags.id, unique))
      .all()
      .map((r) => r.id),
  );
  if (unique.some((id) => !known.has(id))) {
    throw invalidField(field, "A tag does not exist");
  }
  return unique;
}

/** Replaces the tags of an entry. */
export function writeEntryTags(
  db: DB,
  entryId: string,
  tagIds: readonly string[],
): void {
  db.delete(costEntryTags).where(eq(costEntryTags.entryId, entryId)).run();
  if (tagIds.length > 0) {
    db.insert(costEntryTags)
      .values(tagIds.map((tagId) => ({ entryId, tagId })))
      .run();
  }
}

/** Entries asked about in one query; SQLite limits the variables of a statement. */
const CHUNK = 500;

/** The tags of the given entries, by name without regard to case; an entry without tags has no key. */
export function tagsOfEntries(
  db: DB,
  entryIds: readonly string[],
): Map<string, CostTagRef[]> {
  const out = new Map<string, CostTagRef[]>();
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const rows = db
      .select({
        entryId: costEntryTags.entryId,
        id: costTags.id,
        name: costTags.name,
        color: costTags.color,
      })
      .from(costEntryTags)
      .innerJoin(costTags, eq(costTags.id, costEntryTags.tagId))
      .where(inArray(costEntryTags.entryId, entryIds.slice(i, i + CHUNK)))
      .orderBy(asc(sql`lower(${costTags.name})`), asc(costTags.id))
      .all();
    for (const r of rows) {
      const list = out.get(r.entryId) ?? [];
      list.push({ id: r.id, name: r.name, color: r.color });
      out.set(r.entryId, list);
    }
  }
  return out;
}
