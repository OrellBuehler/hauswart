/**
 * The keys the due-date engine gives a task that shows no occurrence at all (a condition that does
 * not hold, a calendar without upcoming events): there is nothing an appointment could be for.
 */
export const NO_OCCURRENCE_KEYS: readonly string[] = ["none", "s:none"];

/** The key to keep as "the occurrence an appointment is for": null when the task shows none. */
export function pinnableOccurrenceKey(
  key: string | null | undefined,
): string | null {
  return key == null || NO_OCCURRENCE_KEYS.includes(key) ? null : key;
}
