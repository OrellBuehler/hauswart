import { addDays, diffDays, isValidDate } from "$lib/dates";
import type { TireEventKind, TireSeason } from "$lib/api/enums";

/**
 * Tread depth in millimetres below which a tire set should be replaced soon, per season. The legal
 * minimum is 1.6 mm; winter tires lose their grip on snow well before that, summer tires on wet roads.
 */
export const TREAD_WARNING_MM: Record<TireSeason, number> = {
  summer: 3,
  winter: 4,
  all_season: 4,
};

/** Whether the measured depth is below the limit of the season; no measurement is no warning. */
export function treadWarning(
  season: TireSeason,
  treadDepthMm: number | null | undefined,
): boolean {
  return (
    typeof treadDepthMm === "number" &&
    Number.isFinite(treadDepthMm) &&
    treadDepthMm < TREAD_WARNING_MM[season]
  );
}

/** Tires older than this many years should be looked at whatever their tread. */
export const TIRE_AGE_WARNING_YEARS = 6;

/** The DOT date code: two digits for the week (01-53), two for the year. */
const DOT_PATTERN = /^(0[1-9]|[1-4]\d|5[0-3])(\d{2})$/;

export function isValidDot(dot: string): boolean {
  return DOT_PATTERN.test(dot);
}

/** The week and the year (20xx) a DOT code such as "2423" stands for, or null if it is none. */
export function parseDot(dot: string): { week: number; year: number } | null {
  const match = DOT_PATTERN.exec(dot);
  return match
    ? { week: Number(match[1]), year: 2000 + Number(match[2]) }
    : null;
}

/** The first day of the week the tire was made (weeks counted from 1 January in 7-day steps, as the code is read on the tire). */
function madeOn(dot: string): string | null {
  const parsed = parseDot(dot);
  if (!parsed) return null;
  const date = addDays(`${parsed.year}-01-01`, (parsed.week - 1) * 7);
  return isValidDate(date) ? date : null;
}

/**
 * How old a tire is in years, to one decimal, from its DOT code; null without a valid code. A code
 * in the future counts as new.
 */
export function tireAgeYears(
  dot: string | null | undefined,
  today: string,
): number | null {
  if (!dot) return null;
  const made = madeOn(dot);
  if (!made) return null;
  const days = Math.max(0, diffDays(today, made));
  return Math.round((days / 365.25) * 10) / 10;
}

export interface TireEventFacts {
  kind: TireEventKind;
  /** `YYYY-MM-DD`. */
  date: string;
  odometer: number | null;
}

export interface OdometerPoint {
  date: string;
  value: number;
}

/** The newest reading on or before the date, or null if there is none. Readings in any order. */
function readingAt(
  readings: readonly OdometerPoint[],
  date: string,
): number | null {
  let best: OdometerPoint | null = null;
  for (const r of readings) {
    if (r.date <= date && (best === null || r.date >= best.date)) best = r;
  }
  return best ? best.value : null;
}

/**
 * Distance driven on a tire set: for every stretch from a mount to the next unmount (or to the
 * newest reading, while it is still mounted) the odometer at the end minus at the start, where an
 * event without an odometer value takes the newest reading on or before its date. A stretch with an
 * end or a start nobody knows counts for nothing. Null when the set was mounted but no stretch can
 * be measured, 0 when it never was. `events` in the order they happened (same-day events as given).
 */
export function tireSetDistance(
  events: readonly TireEventFacts[],
  readings: readonly OdometerPoint[],
): number | null {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind !== "tread_measured")
    .sort((a, b) =>
      a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i,
    )
    .map(({ e }) => e);
  let mounts = 0;
  let measured = false;
  let total = 0;
  let start: number | null | undefined;
  const close = (end: number | null) => {
    if (start !== undefined && start !== null && end !== null) {
      total += Math.max(0, end - start);
      measured = true;
    }
    start = undefined;
  };
  for (const event of ordered) {
    const at = event.odometer ?? readingAt(readings, event.date);
    if (event.kind === "mounted") {
      if (start !== undefined) close(at);
      mounts += 1;
      start = at;
    } else if (start !== undefined) {
      close(at);
    }
  }
  if (start !== undefined) {
    const newest = readings.reduce<OdometerPoint | null>(
      (best, r) => (best === null || r.date >= best.date ? r : best),
      null,
    );
    close(newest ? newest.value : null);
  }
  if (mounts === 0) return 0;
  return measured ? total : null;
}
