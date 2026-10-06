import { invalidateAll } from "$app/navigation";
import { toast } from "svelte-sonner";
import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import { formatDate } from "$lib/format";
import { m } from "$lib/paraglide/messages";
import { apiErrorMessage } from "$lib/error-message";

const TOAST_MS = 8000;

/** A random key for idempotent retries; `crypto.randomUUID` is missing on plain-HTTP origins. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function undoCompletion(completionId: string): Promise<void> {
  try {
    await api.call(endpoints.completionsUndo, { params: { id: completionId } });
    toast.success(m.toast_undone());
  } catch (err) {
    toast.error(apiErrorMessage(err));
  }
  await invalidateAll();
}

export type CompleteOptions = {
  note?: string | null;
  /** ISO instant for a backdated completion; omit for "now". */
  completedAt?: string;
};

export async function completeTask(
  task: { id: string; title: string },
  options: CompleteOptions = {},
): Promise<void> {
  const { completion } = await api.call(endpoints.tasksComplete, {
    params: { id: task.id },
    body: {
      idempotencyKey: newIdempotencyKey(),
      ...(options.note ? { note: options.note } : {}),
      ...(options.completedAt ? { completedAt: options.completedAt } : {}),
    },
  });
  toast.success(m.toast_completed({ title: task.title }), {
    duration: TOAST_MS,
    action: {
      label: m.toast_undo(),
      onClick: () => void undoCompletion(completion.id),
    },
  });
  await invalidateAll();
}

export async function skipTask(
  task: { id: string; title: string },
  note?: string | null,
): Promise<void> {
  const { completion } = await api.call(endpoints.tasksSkip, {
    params: { id: task.id },
    body: {
      idempotencyKey: newIdempotencyKey(),
      ...(note ? { note } : {}),
    },
  });
  toast.success(m.toast_skipped({ title: task.title }), {
    duration: TOAST_MS,
    action: {
      label: m.toast_undo(),
      onClick: () => void undoCompletion(completion.id),
    },
  });
  await invalidateAll();
}

/** Hides a task until `until`; `null` ends a snooze. `previous` is restored by "Undo". */
export async function snoozeTask(
  task: { id: string; title: string },
  until: string | null,
  previous: string | null = null,
): Promise<void> {
  await api.call(endpoints.tasksSnooze, {
    params: { id: task.id },
    body: { until },
  });
  const restore = async () => {
    try {
      await api.call(endpoints.tasksSnooze, {
        params: { id: task.id },
        body: { until: previous },
      });
      toast.success(m.toast_undone());
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  };
  toast.success(
    until
      ? m.toast_snoozed({ title: task.title, date: formatDate(until) })
      : m.toast_unsnoozed({ title: task.title }),
    {
      duration: TOAST_MS,
      action: { label: m.toast_undo(), onClick: () => void restore() },
    },
  );
  await invalidateAll();
}
