import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
import { daysInMonth } from "$lib/dates";

export const MIN_YEAR = 1990;
export const MAX_YEAR = 2200;

export type CostFilters = {
  year: number;
  q: string;
  category: CostCategory | "";
  assetId: string;
  roomId: string;
  defectId: string;
  /** A user id, or `me`. */
  paidBy: string;
  /** `01` to `12` of the selected year, or empty for the whole year. */
  month: string;
};

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

function parseYear(value: string | null, fallback: number): number {
  if (!value || !/^\d{4}$/.test(value)) return fallback;
  const year = Number(value);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : fallback;
}

/** `year` falls back to `defaultYear` (the current year in the household's zone). */
export function parseCostFilters(
  params: URLSearchParams,
  defaultYear: number,
): CostFilters {
  const category = params.get("category");
  const month = params.get("month") ?? "";
  return {
    year: parseYear(params.get("year"), defaultYear),
    q: (params.get("q") ?? "").trim().slice(0, 100),
    category: COST_CATEGORIES.find((c) => c === category) ?? "",
    assetId: params.get("asset") ?? "",
    roomId: params.get("room") ?? "",
    defectId: params.get("defect") ?? "",
    paidBy: params.get("paidBy") ?? "",
    month: MONTHS.includes(month) ? month : "",
  };
}

export function costFilterQuery(
  filters: CostFilters,
  defaultYear: number,
): string {
  const params = new URLSearchParams();
  if (filters.year !== defaultYear) params.set("year", String(filters.year));
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.assetId) params.set("asset", filters.assetId);
  if (filters.roomId) params.set("room", filters.roomId);
  if (filters.defectId) params.set("defect", filters.defectId);
  if (filters.paidBy) params.set("paidBy", filters.paidBy);
  if (filters.month) params.set("month", filters.month);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Filters set in the panel (the year and the search box are counted apart). */
export function activeFilterCount(filters: CostFilters): number {
  return [
    filters.category,
    filters.assetId,
    filters.roomId,
    filters.defectId,
    filters.paidBy,
    filters.month,
  ].filter(Boolean).length;
}

/** The first and last day of a month of `year`. */
export function monthRange(
  year: number,
  month: string,
): { from: string; to: string } {
  const last = daysInMonth(year, Number(month));
  const y = String(year).padStart(4, "0");
  return {
    from: `${y}-${month}-01`,
    to: `${y}-${month}-${String(last).padStart(2, "0")}`,
  };
}

/** One page of the list endpoint for the filters; the year always applies, a month narrows it. */
export function costsQuery(filters: CostFilters, cursor?: string) {
  return {
    limit: 200,
    year: filters.year,
    ...(cursor ? { cursor } : {}),
    ...(filters.month ? monthRange(filters.year, filters.month) : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assetId ? { assetId: filters.assetId } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.defectId ? { defectId: filters.defectId } : {}),
    ...(filters.paidBy ? { paidBy: filters.paidBy } : {}),
  };
}

/** The same filters one year later or earlier, keeping everything else but the month. */
export function withYear(filters: CostFilters, year: number): CostFilters {
  return { ...filters, year, month: "" };
}

/** The years the selector offers: next year back to ten years ago, plus the selected one. */
export function yearOptions(currentYear: number, selected: number): number[] {
  const years = new Set<number>([selected]);
  for (let year = currentYear + 1; year >= currentYear - 10; year -= 1) {
    years.add(year);
  }
  return [...years]
    .filter((year) => year >= MIN_YEAR && year <= MAX_YEAR)
    .sort((a, b) => b - a);
}
