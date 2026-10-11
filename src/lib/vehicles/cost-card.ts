import { MAX_YEAR, MIN_YEAR } from "$lib/costs/filters";

const MAX_YEARS_BACK = 20;
const MIN_YEARS_BACK = 1;

export function statsYears(
  today: string,
  dates: readonly (string | null | undefined)[],
): number[] {
  const current = Number(today.slice(0, 4));
  const earliest = dates
    .map((date) => (date ? Number(date.slice(0, 4)) : Number.NaN))
    .filter((year) => Number.isInteger(year));
  const start = Math.min(current - MIN_YEARS_BACK, ...earliest);
  const oldest = Math.max(start, current - MAX_YEARS_BACK, MIN_YEAR);
  const years: number[] = [];
  for (let year = Math.min(current, MAX_YEAR); year >= oldest; year -= 1) {
    years.push(year);
  }
  return years;
}

export function costShare(totalMinor: number, partMinor: number): number {
  return totalMinor > 0 ? Math.round((partMinor / totalMinor) * 100) : 0;
}

export function vehicleCostsQuery(assetId: string, year: number): string {
  return `?${new URLSearchParams({ asset: assetId, year: String(year) })}`;
}
