import {
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  type DefectSeverity,
  type DefectStatus,
} from "$lib/api/enums";
import { ACTIVE_DEFECT_STATUSES, type Defect } from "$lib/api/schemas/defects";

export const DEFECT_SORTS = ["deadline", "number"] as const;
export type DefectSort = (typeof DEFECT_SORTS)[number];

export type DefectFilters = {
  q: string;
  /** Selected statuses; the default is every status that still needs attention. */
  statuses: DefectStatus[];
  severity: DefectSeverity | "";
  roomId: string;
  assetId: string;
  sort: DefectSort;
};

export const DEFAULT_STATUSES: DefectStatus[] = [...ACTIVE_DEFECT_STATUSES];

export const DEFAULT_DEFECT_FILTERS: DefectFilters = {
  q: "",
  statuses: DEFAULT_STATUSES,
  severity: "",
  roomId: "",
  assetId: "",
  sort: "deadline",
};

export function isActiveStatus(status: DefectStatus): boolean {
  return (ACTIVE_DEFECT_STATUSES as readonly string[]).includes(status);
}

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | "" {
  return allowed.find((candidate) => candidate === value) ?? "";
}

/** `status=` is a comma list, `all` stands for every status; no parameter means the default. */
export function parseDefectFilters(params: URLSearchParams): DefectFilters {
  const raw = params.get("status");
  let statuses = DEFAULT_STATUSES;
  if (raw === "all") {
    statuses = [...DEFECT_STATUSES];
  } else if (raw !== null) {
    const wanted = raw.split(",");
    const picked = DEFECT_STATUSES.filter((s) => wanted.includes(s));
    if (picked.length > 0) statuses = picked;
  }
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    statuses,
    severity: pick(params.get("severity"), DEFECT_SEVERITIES),
    roomId: params.get("room") ?? "",
    assetId: params.get("asset") ?? "",
    sort: pick(params.get("sort"), DEFECT_SORTS) || "deadline",
  };
}

function sameStatuses(a: DefectStatus[], b: DefectStatus[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

export function defectFilterQuery(filters: DefectFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (!sameStatuses(filters.statuses, DEFAULT_STATUSES)) {
    params.set(
      "status",
      filters.statuses.length === DEFECT_STATUSES.length
        ? "all"
        : DEFECT_STATUSES.filter((s) => filters.statuses.includes(s)).join(","),
    );
  }
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.roomId) params.set("room", filters.roomId);
  if (filters.assetId) params.set("asset", filters.assetId);
  if (filters.sort !== "deadline") params.set("sort", filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Filters that differ from the defaults (the search box is counted apart). */
export function activeFilterCount(filters: DefectFilters): number {
  return [
    !sameStatuses(filters.statuses, DEFAULT_STATUSES),
    filters.severity,
    filters.roomId,
    filters.assetId,
    filters.sort !== "deadline",
  ].filter(Boolean).length;
}

/** What the API can filter; the status selection is applied on the client. */
export function defectsQuery(filters: DefectFilters, cursor?: string) {
  return {
    limit: 200,
    ...(cursor ? { cursor } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.assetId ? { assetId: filters.assetId } : {}),
  };
}

/**
 * The list as the API orders it (active ones first, by deadline, none last),
 * restricted to the selected statuses; "number" sorts newest first.
 */
export function applyDefectFilters(
  defects: Defect[],
  filters: DefectFilters,
): Defect[] {
  const shown = defects.filter((d) => filters.statuses.includes(d.status));
  if (filters.sort === "number") {
    return [...shown].sort((a, b) => b.number - a.number);
  }
  return shown;
}

/** The PDF export takes one status; several selected statuses export every status. */
export function exportQuery(filters: DefectFilters) {
  return {
    ...(filters.statuses.length === 1 ? { status: filters.statuses[0] } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
  };
}
