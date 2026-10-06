import { MAX_GUEST_LINK_DAYS } from "$lib/api/schemas/share";
import { addDays, zonedTimeToInstant } from "$lib/dates";

const DAY_MS = 86_400_000;

export const DEFAULT_GUEST_DAYS = 14;

export function defaultUntil(today: string): string {
  return addDays(today, DEFAULT_GUEST_DAYS);
}

/** Latest day a link can run to: the API allows 90 days from now. */
export function latestUntil(today: string): string {
  return addDays(today, MAX_GUEST_LINK_DAYS);
}

/** First moment of `date` in the household zone. */
export function startInstant(date: string, timeZone: string): number {
  return zonedTimeToInstant(date, "00:00", timeZone);
}

/** End of `date` in the household zone, never past the API's 90-day limit. */
export function endInstant(
  date: string,
  timeZone: string,
  now: number,
): number {
  const end = zonedTimeToInstant(date, "23:59", timeZone);
  return Math.min(end, now + MAX_GUEST_LINK_DAYS * DAY_MS - 60_000);
}
