import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
import { daysInMonth } from "$lib/dates";
import { bookParam, parseBookParam } from "./books";

export const MIN_YEAR = 1990;
export const MAX_YEAR = 2200;

export type CostFilters = {
  /** The book on screen; empty for every book. */
  bookId: string;
  year: number;
  q: string;
  category: CostCategory | "";
  assetId: string;
  roomId: string;
  defectId: string;
  /** A user id, or `me`. */
  paidBy: string;
  /** Only the entries that carry this tag (`?tag=`); empty for any. */
  tagId: string;
  /** `01` to `12` of the selected year, or empty for the whole year. */
  month: string;
  /** Only the entries a person still has to review (`?review=1`). */
  reviewNeeded: boolean;
  /** With the review filter: the entries of every year (`?year=all`), the way the dashboard counts them. */
  allYears: boolean;
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
  const reviewNeeded = params.get("review") === "1";
  return {
    bookId: parseBookParam(params.get("book")) ?? "",
    year: parseYear(params.get("year"), defaultYear),
    q: (params.get("q") ?? "").trim().slice(0, 100),
    category: COST_CATEGORIES.find((c) => c === category) ?? "",
    assetId: params.get("asset") ?? "",
    roomId: params.get("room") ?? "",
    defectId: params.get("defect") ?? "",
    paidBy: params.get("paidBy") ?? "",
    tagId: (params.get("tag") ?? "").trim(),
    month: MONTHS.includes(month) ? month : "",
    reviewNeeded,
    // Every year of the whole list would be unbounded; the review list is short.
    allYears: reviewNeeded && params.get("year") === "all",
  };
}

export function costFilterQuery(
  filters: CostFilters,
  defaultYear: number,
): string {
  const params = new URLSearchParams();
  params.set("book", bookParam(filters.bookId));
  if (filters.allYears && filters.reviewNeeded) params.set("year", "all");
  else if (filters.year !== defaultYear) {
    params.set("year", String(filters.year));
  }
  if (filters.reviewNeeded) params.set("review", "1");
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.assetId) params.set("asset", filters.assetId);
  if (filters.roomId) params.set("room", filters.roomId);
  if (filters.defectId) params.set("defect", filters.defectId);
  if (filters.paidBy) params.set("paidBy", filters.paidBy);
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.month && !filters.allYears) params.set("month", filters.month);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Whether the address narrows the list by something other than the book, say a link to the costs of one device. Such
 * a link shows what it was made to show, whichever book the person looked at last.
 */
export function narrowsBeyondBook(params: URLSearchParams): boolean {
  return [
    "q",
    "category",
    "asset",
    "room",
    "defect",
    "paidBy",
    "tag",
    "month",
    "review",
  ].some((key) => (params.get(key) ?? "").trim() !== "");
}

/** Filters set in the panel (the year and the search box are counted apart). */
export function activeFilterCount(filters: CostFilters): number {
  return [
    filters.category,
    filters.assetId,
    filters.roomId,
    filters.defectId,
    filters.paidBy,
    filters.tagId,
    filters.month,
  ].filter(Boolean).length;
}

/** Whether anything but the year and the book narrows the list: the panel's filters, the search or the review filter. */
export function isFiltered(filters: CostFilters): boolean {
  return (
    activeFilterCount(filters) > 0 || filters.q !== "" || filters.reviewNeeded
  );
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
    ...(filters.allYears ? {} : { year: filters.year }),
    ...(filters.bookId ? { bookId: filters.bookId } : {}),
    ...(cursor ? { cursor } : {}),
    ...(filters.month && !filters.allYears
      ? monthRange(filters.year, filters.month)
      : {}),
    ...(filters.reviewNeeded ? { reviewNeeded: "true" as const } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assetId ? { assetId: filters.assetId } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.defectId ? { defectId: filters.defectId } : {}),
    ...(filters.paidBy ? { paidBy: filters.paidBy } : {}),
    ...(filters.tagId ? { tagId: filters.tagId } : {}),
  };
}

/** The summary follows the year, the book, the device and the tag; the other filters only narrow the list. */
export function costsSummaryQuery(filters: CostFilters) {
  return {
    year: filters.year,
    assetId: filters.assetId || undefined,
    bookId: filters.bookId || undefined,
    tagId: filters.tagId || undefined,
  };
}

/** The CSV file covers the year of the book (and the tag) on screen: every book and every tag without one. */
export function costsExportQuery(filters: CostFilters) {
  return {
    year: filters.year,
    bookId: filters.bookId || undefined,
    tagId: filters.tagId || undefined,
  };
}

/**
 * The filters with a tag that does not exist (any more) left out: the endpoints answer 404 for an unknown `tagId`, which
 * would turn a stale link into an error page.
 */
export function withKnownTag(
  filters: CostFilters,
  tags: readonly { id: string }[],
): CostFilters {
  return filters.tagId !== "" && !tags.some((tag) => tag.id === filters.tagId)
    ? { ...filters, tagId: "" }
    : filters;
}

/** The same filters one year later or earlier, keeping everything else but the month. */
export function withYear(filters: CostFilters, year: number): CostFilters {
  return { ...filters, year, month: "", allYears: false };
}

/**
 * The entries `GET /costs/summary` counted as waiting for a review: its year, book, device and tag, nothing else. The
 * summary's `reviewNeededCount` and the list this opens agree.
 */
export function reviewFilters(filters: CostFilters): CostFilters {
  return {
    ...filters,
    q: "",
    category: "",
    roomId: "",
    defectId: "",
    paidBy: "",
    month: "",
    reviewNeeded: true,
    allYears: false,
  };
}

/** The costs page for the entries to review in every book and year: what the dashboard's count is about. */
export const REVIEW_ALL_HREF = "/costs?book=all&year=all&review=1";

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
