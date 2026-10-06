import { inArray } from "drizzle-orm";
import type { z } from "zod";
import type {
  SEARCH_HIT_TYPES,
  searchHitSchema,
} from "$lib/api/schemas/search";
import {
  assetHints,
  assets,
  contacts,
  defects,
  docPages,
  parts,
  rooms,
  tasks,
} from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

/** The kinds of the full-text index; documents are searched separately, per caller (`documents/search.ts`). */
export type SearchKind = Exclude<(typeof SEARCH_HIT_TYPES)[number], "document">;
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

type Urls = (ctx: Db, ids: string[]) => Map<string, string>;

const urlsOf = <T extends { id: string }>(
  rows: T[],
  url: (row: T) => string,
): Map<string, string> => new Map(rows.map((row) => [row.id, url(row)]));

/**
 * App path of a hit per kind (the routes of the UI). Hits whose entity is gone (an index row
 * should never outlive it) get no URL and are dropped.
 */
const URLS: Record<SearchKind, Urls> = {
  page: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: docPages.id, slug: docPages.slug })
        .from(docPages)
        .where(inArray(docPages.id, ids))
        .all(),
      (row) => `/docs/${row.slug}`,
    ),
  asset: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, ids))
        .all(),
      (row) => `/assets/${row.id}`,
    ),
  room: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: rooms.id })
        .from(rooms)
        .where(inArray(rooms.id, ids))
        .all(),
      (row) => `/rooms/${row.id}`,
    ),
  task: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.id, ids))
        .all(),
      (row) => `/tasks/${row.id}`,
    ),
  defect: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: defects.id })
        .from(defects)
        .where(inArray(defects.id, ids))
        .all(),
      (row) => `/defects/${row.id}`,
    ),
  part: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: parts.id })
        .from(parts)
        .where(inArray(parts.id, ids))
        .all(),
      (row) => `/parts/${row.id}`,
    ),
  contact: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(inArray(contacts.id, ids))
        .all(),
      (row) => `/contacts/${row.id}`,
    ),
  asset_hint: (ctx, ids) =>
    urlsOf(
      ctx.db
        .select({ id: assetHints.id, assetId: assetHints.assetId })
        .from(assetHints)
        .where(inArray(assetHints.id, ids))
        .all(),
      (row) => `/assets/${row.assetId}`,
    ),
};

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
  const urls = new Map<SearchKind, Map<string, string>>();
  for (const kind of new Set(rows.map((row) => row.kind))) {
    urls.set(
      kind,
      URLS[kind](
        ctx,
        rows.filter((row) => row.kind === kind).map((row) => row.ref),
      ),
    );
  }

  const hits: SearchHit[] = [];
  for (const row of rows) {
    const url = urls.get(row.kind)?.get(row.ref);
    if (url === undefined) continue;
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
