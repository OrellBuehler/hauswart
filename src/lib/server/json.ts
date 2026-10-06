import type { z } from "zod";

/**
 * JSON columns are written and read through a Zod schema. A stored value that
 * no longer fits is a bug or a hand edit; the message names the column, never
 * the content.
 */
export function parseStored<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Stored ${what} is invalid`, { cause: parsed.error });
  }
  return parsed.data;
}
