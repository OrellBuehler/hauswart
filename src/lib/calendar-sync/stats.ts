import type { CalendarSyncCounts } from "$lib/api/schemas/calendar-sync";
import { m } from "$lib/paraglide/messages";

type CountKey = keyof CalendarSyncCounts;

/** What a run did, in the order people care about; each entry words one non-zero count. */
const LINES: readonly [CountKey, (count: number) => string][] = [
  ["created", (count) => m.caltargets_stats_created({ count })],
  ["updated", (count) => m.caltargets_stats_updated({ count })],
  ["replaced", (count) => m.caltargets_stats_replaced({ count })],
  ["deleted", (count) => m.caltargets_stats_deleted({ count })],
  ["adopted", (count) => m.caltargets_stats_adopted({ count })],
  ["forgotten", (count) => m.caltargets_stats_forgotten({ count })],
  ["skipped", (count) => m.caltargets_stats_skipped({ count })],
  ["unconfirmed", (count) => m.caltargets_stats_unconfirmed({ count })],
  ["failed", (count) => m.caltargets_stats_failed({ count })],
  ["remaining", (count) => m.caltargets_stats_remaining({ count })],
];

/** One short phrase per count that is not zero ("3 neu", "1 geändert"). */
export function statLines(counts: CalendarSyncCounts): string[] {
  return LINES.flatMap(([key, word]) =>
    counts[key] > 0 ? [word(counts[key])] : [],
  );
}

/** The phrases of a run in one line, or a sentence saying nothing had to be done. */
export function statsSummary(counts: CalendarSyncCounts): string {
  const lines = statLines(counts);
  return lines.length === 0 ? m.caltargets_stats_nothing() : lines.join(", ");
}
