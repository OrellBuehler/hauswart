import { inArray } from "drizzle-orm";
import type { z } from "zod";
import type {
  SEARCH_HIT_TYPES,
  searchHitSchema,
} from "$lib/api/schemas/search";
import { assets, docPages, rooms, tasks } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type SearchKind = (typeof SEARCH_HIT_TYPES)[number];
export type SearchHit = z.input<typeof searchHitSchema>;

const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 64;

/**
 * FTS5 expression for free text: every word (letters and digits only, so no operator or quote
 * can get through) becomes a quoted prefix term, all of them must match. Null when the text has
 * no searchable word.
 */
export function ftsExpression(text: string): string | null {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  return words
    .slice(0, MAX_WORDS)
    .map((word) => `"${word.slice(0, MAX_WORD_LENGTH)}"*`)
    .join(" ");
}

interface Row {
  kind: SearchKind;
  ref: string;
  title: string;
  snippet: string;
}

/**
 * Best matches first. The index (`search_fts`, maintained by triggers, see the search migration)
 * holds no secret text, so neither do the rows or snippets returned here.
 */
function query(
  ctx: Db,
  text: string,
  kinds: readonly SearchKind[] | undefined,
  limit: number,
): Row[] {
  const expression = ftsExpression(text);
  if (!expression) return [];
  const filter = kinds
    ? ` AND kind IN (${kinds.map(() => "?").join(", ")})`
    : "";
  return ctx.db.$client
    .query(
      `SELECT kind, ref, title, snippet(search_fts, 3, '', '', '…', 14) AS snippet
       FROM search_fts
       WHERE search_fts MATCH ?${filter}
       ORDER BY bm25(search_fts, 0.0, 0.0, 6.0, 1.0)
       LIMIT ?`,
    )
    .all(expression, ...(kinds ?? []), limit) as Row[];
}

/** Ids of the entities of one kind that match, best match first. */
export function searchRefs(
  ctx: Db,
  kind: SearchKind,
  text: string,
  limit = 500,
): string[] {
  return query(ctx, text, [kind], limit).map((row) => row.ref);
}

export function search(
  ctx: Db,
  input: { q: string; type?: SearchKind; limit: number },
): SearchHit[] {
  const rows = query(
    ctx,
    input.q,
    input.type ? [input.type] : undefined,
    input.limit,
  );
  const ids = (kind: SearchKind) =>
    rows.filter((row) => row.kind === kind).map((row) => row.ref);

  const slugs = new Map(
    ids("page").length === 0
      ? []
      : ctx.db
          .select({ id: docPages.id, slug: docPages.slug })
          .from(docPages)
          .where(inArray(docPages.id, ids("page")))
          .all()
          .map((row) => [row.id, row.slug]),
  );
  const assetKinds = new Map(
    ids("asset").length === 0
      ? []
      : ctx.db
          .select({ id: assets.id, kind: assets.kind })
          .from(assets)
          .where(inArray(assets.id, ids("asset")))
          .all()
          .map((row) => [row.id, row.kind]),
  );
  const roomIds = new Set(
    ids("room").length === 0
      ? []
      : ctx.db
          .select({ id: rooms.id })
          .from(rooms)
          .where(inArray(rooms.id, ids("room")))
          .all()
          .map((row) => row.id),
  );
  const taskIds = new Set(
    ids("task").length === 0
      ? []
      : ctx.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.id, ids("task")))
          .all()
          .map((row) => row.id),
  );

  const urlOf = (row: Row): string | null => {
    switch (row.kind) {
      case "page": {
        const slug = slugs.get(row.ref);
        return slug === undefined ? null : `/docs/${slug}`;
      }
      case "asset": {
        const kind = assetKinds.get(row.ref);
        if (kind === undefined) return null;
        return `${kind === "plant" ? "/plants" : "/inventory"}/${row.ref}`;
      }
      case "room":
        return roomIds.has(row.ref) ? `/rooms/${row.ref}` : null;
      case "task":
        return taskIds.has(row.ref) ? `/tasks/${row.ref}` : null;
    }
  };

  const hits: SearchHit[] = [];
  for (const row of rows) {
    const url = urlOf(row);
    if (url === null) continue;
    hits.push({
      type: row.kind,
      id: row.ref,
      title: row.title,
      snippet: row.snippet,
      url,
    });
  }
  return hits;
}
