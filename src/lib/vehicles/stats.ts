import { dayNumber, monthEnd } from "$lib/dates";

export interface OdometerPoint {
  date: string;
  value: number;
}

interface Segment {
  /** First and last day (day numbers) the distance of the segment is spread over. */
  first: number;
  last: number;
  distance: number;
}

/**
 * The distance between two readings, spread evenly over the days after the first up to and
 * including the day of the second (readings of one day: that day). A reading lower than the one
 * before (a replaced instrument cluster) adds nothing.
 */
function segmentsOf(readings: readonly OdometerPoint[]): Segment[] {
  const sorted = readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i,
    )
    .map(({ r }) => r);
  const out: Segment[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const before = sorted[i - 1];
    const after = sorted[i];
    const distance = Math.max(0, after.value - before.value);
    if (distance === 0) continue;
    const last = dayNumber(after.date);
    const first = Math.min(last, dayNumber(before.date) + 1);
    out.push({ first, last, distance });
  }
  return out;
}

function within(
  segments: readonly Segment[],
  from: string,
  to: string,
): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  let total = 0;
  for (const s of segments) {
    const overlap = Math.min(b, s.last) - Math.max(a, s.first) + 1;
    if (overlap > 0) total += (s.distance * overlap) / (s.last - s.first + 1);
  }
  return total;
}

/**
 * How far the vehicle was driven between two days (both included), from the readings: the distance
 * between two readings counts evenly for the days in between, so a reading in the middle of a month
 * splits the stretch across the months. Nothing before the first or after the last reading.
 */
export function distanceBetween(
  readings: readonly OdometerPoint[],
  from: string,
  to: string,
): number {
  return within(segmentsOf(readings), from, to);
}

/** The distance per month, for the given months (`YYYY-MM`) in the given order. */
export function distanceByMonth(
  readings: readonly OdometerPoint[],
  months: readonly string[],
): { month: string; distance: number }[] {
  const segments = segmentsOf(readings);
  return months.map((month) => ({
    month,
    distance: within(segments, `${month}-01`, monthEnd(`${month}-01`)),
  }));
}

/** The months from the one of `from` to the one of `to`, both included (`YYYY-MM`). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
    );
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** Rounded to one decimal, which is as exact as an odometer is. */
export const round1 = (value: number): number => Math.round(value * 10) / 10;
