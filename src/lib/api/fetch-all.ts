type Page<T> = { items: T[]; nextCursor: string | null };

/** Follows `nextCursor` until the list is exhausted. */
export async function fetchAll<T>(
  page: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    all.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return all;
}
