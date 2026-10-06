import { z } from "zod";
import { ApiError } from "$lib/api/errors";

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Cursors are opaque to clients; a forged or stale one is a 400, never a 500. */
export function decodeCursor<S extends z.ZodType>(
  cursor: string,
  schema: S,
): z.output<S> {
  const invalid = () =>
    new ApiError("invalid_request", "Invalid request", {
      details: {
        query: { formErrors: [], fieldErrors: { cursor: ["Invalid cursor"] } },
      },
    });
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw invalid();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

const offsetCursorSchema = z.object({ o: z.number().int().min(0) });

/** Pages through an already sorted array; the cursor carries the offset. */
export function paginateArray<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const offset = cursor ? decodeCursor(cursor, offsetCursorSchema).o : 0;
  const page = items.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    items: page,
    nextCursor: next < items.length ? encodeCursor({ o: next }) : null,
  };
}

/**
 * For keyset pages: fetch `limit + 1` rows, then cut the extra one and build the
 * cursor from the last row that stays.
 */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => unknown,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: [...rows], nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(cursorOf(items[limit - 1])) };
}
