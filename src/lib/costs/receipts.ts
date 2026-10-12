import { endpointUrl } from "$lib/api/client";
import type { AiTaskClosedVia, AiTaskStatus } from "$lib/api/enums";
import { endpoints } from "$lib/api/registry";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import { m } from "$lib/paraglide/messages";

/** Which tasks the receipts page lists: everything (open ones first) or one status. */
export const RECEIPT_VIEWS = ["all", "pending", "done", "dismissed"] as const;
export type ReceiptView = (typeof RECEIPT_VIEWS)[number];

/** Tasks per page of the history; "load more" fetches the next. */
export const RECEIPTS_PAGE_SIZE = 30;

/** `?status=` of the address; anything unknown lists everything. */
export function parseReceiptView(params: URLSearchParams): ReceiptView {
  const value = params.get("status");
  return RECEIPT_VIEWS.find((view) => view === value) ?? "all";
}

/** The query of the address for a view (none for everything). */
export function receiptViewQuery(view: ReceiptView): string {
  return view === "all" ? "" : `?status=${view}`;
}

/** The status the API is asked for, none for everything. */
export function receiptViewStatus(view: ReceiptView): AiTaskStatus | undefined {
  return view === "all" ? undefined : view;
}

/**
 * Everything that waits first, then the rest as the page gives it (newest first). The open tasks are read completely, so
 * one that sits on a later page of the whole list is not hidden behind the finished ones, and not shown twice.
 */
export function mergePendingFirst(
  pending: readonly AiTask[],
  page: readonly AiTask[],
): AiTask[] {
  const ids = new Set(pending.map((task) => task.id));
  return [...pending, ...page.filter((task) => !ids.has(task.id))];
}

/** The tasks of a further page behind the ones shown, each task once (the list moves while somebody reads it). */
export function appendTasks(
  shown: readonly AiTask[],
  more: readonly AiTask[],
): AiTask[] {
  const ids = new Set(shown.map((task) => task.id));
  return [...shown, ...more.filter((task) => !ids.has(task.id))];
}

/** Deleting is for the person who uploaded the receipt and for administrators; a task without an uploader, for them only. */
export function canDeleteTask(
  task: Pick<AiTask, "createdByUserId">,
  user: { id: string; role: string },
): boolean {
  return user.role === "admin" || task.createdByUserId === user.id;
}

/** Whether the file is a picture (else a PDF, or none). */
export function isImageTask(task: Pick<AiTask, "attachment">): boolean {
  return task.attachment?.mime.startsWith("image/") ?? false;
}

/**
 * The small picture of a task: the thumbnail of its file, else the task's preview for a picture without one; nothing for a
 * PDF or a task whose file is gone.
 */
export function taskThumbSrc(
  task: Pick<AiTask, "id" | "attachment">,
): string | null {
  if (!task.attachment) return null;
  if (task.attachment.thumbUrl) return task.attachment.thumbUrl;
  return isImageTask(task)
    ? endpointUrl(endpoints.aiTasksPreview, { params: { id: task.id } })
    : null;
}

export const statusLabels: Record<AiTaskStatus, () => string> = {
  pending: () => m.receipts_status_pending(),
  done: () => m.receipts_status_done(),
  dismissed: () => m.receipts_status_dismissed(),
};

/** How a task left the queue, in a few words. */
export function closedViaLabel(via: AiTaskClosedVia | null): string | null {
  switch (via) {
    case null:
      return null;
    case "session":
      return m.receipts_via_session();
    case "mcp":
      return m.receipts_via_mcp();
    case "ha":
      return m.receipts_via_ha();
    case "mobile":
    case "integration":
      return m.receipts_via_api();
  }
}
