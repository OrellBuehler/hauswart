import { TASK_CATEGORIES, type TaskCategory } from "$lib/api/enums";
import { DUE_STATUSES } from "$lib/api/enums";
import type { DueStatus } from "./engine/types";

export const TASK_VIEWS = ["status", "due", "title"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type TaskFilters = {
  q: string;
  status: DueStatus | "";
  category: TaskCategory | "";
  /** "me" or "" for everyone. */
  assignee: "me" | "";
  roomId: string;
  assetId: string;
  archived: boolean;
  view: TaskView;
};

export const DEFAULT_FILTERS: TaskFilters = {
  q: "",
  status: "",
  category: "",
  assignee: "",
  roomId: "",
  assetId: "",
  archived: false,
  view: "status",
};

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | "" {
  return allowed.find((candidate) => candidate === value) ?? "";
}

export function parseTaskFilters(params: URLSearchParams): TaskFilters {
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    status: pick(params.get("status"), DUE_STATUSES),
    category: pick(params.get("category"), TASK_CATEGORIES),
    assignee: params.get("assignee") === "me" ? "me" : "",
    roomId: params.get("room") ?? "",
    assetId: params.get("asset") ?? "",
    archived: params.get("archived") === "1",
    view: pick(params.get("view"), TASK_VIEWS) || DEFAULT_FILTERS.view,
  };
}

/** The filters as a query string without defaults, e.g. `?status=due&assignee=me`. */
export function taskFilterQuery(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  if (filters.assignee) params.set("assignee", filters.assignee);
  if (filters.roomId) params.set("room", filters.roomId);
  if (filters.assetId) params.set("asset", filters.assetId);
  if (filters.archived) params.set("archived", "1");
  if (filters.view !== DEFAULT_FILTERS.view) params.set("view", filters.view);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function activeFilterCount(filters: TaskFilters): number {
  return [
    filters.status,
    filters.category,
    filters.assignee,
    filters.roomId,
    filters.assetId,
    filters.archived,
  ].filter(Boolean).length;
}

export const TASK_PAGE_SIZE = 100;

/** The `GET /tasks` query for a set of filters (and a cursor for further pages). */
export function tasksQuery(filters: TaskFilters, cursor?: string) {
  return {
    limit: TASK_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.roomId ? { roomId: filters.roomId } : {}),
    ...(filters.assetId ? { assetId: filters.assetId } : {}),
    ...(filters.archived ? { includeArchived: "true" as const } : {}),
  };
}
