const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * Whether `now` falls into the quiet window `start`..`end` (`HH:MM`, local
 * time of `timeZone`). The window may wrap midnight (22:00-07:00); the start
 * is inside, the end is outside. No window (a missing bound, or both equal)
 * is never quiet.
 */
export function inQuietHours(
  now: number,
  timeZone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end || start === end) return false;
  const minute = localMinutes(now, timeZone);
  const from = toMinutes(start);
  const to = toMinutes(end);
  return from < to
    ? minute >= from && minute < to
    : minute >= from || minute < to;
}
