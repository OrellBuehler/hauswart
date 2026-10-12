/** The list with the item at `index` moved one place; `null` when it cannot move that way. */
export function movedBy<T>(
  list: readonly T[],
  index: number,
  delta: -1 | 1,
): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= list.length) return null;
  if (target < 0 || target >= list.length) return null;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/**
 * Saves a new order: runs the requests that renumber the items and waits for all of them, a failed one included (the
 * others may still be on their way), then refreshes. Some requests may have gone through even when one failed, so what
 * is shown has to come from the server either way. Returns the errors, none when everything was saved.
 */
export async function saveOrder(
  calls: ReadonlyArray<() => Promise<unknown>>,
  refresh: () => Promise<unknown>,
): Promise<unknown[]> {
  const results = await Promise.allSettled(calls.map((call) => call()));
  await refresh();
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
}
