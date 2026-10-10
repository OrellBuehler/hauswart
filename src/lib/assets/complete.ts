import { invalidateAll } from "$app/navigation";
import { toast } from "svelte-sonner";
import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { Task } from "$lib/api/schemas/tasks";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";

const TOAST_MS = 8000;

/**
 * Marks a task done from a list and offers an undo in the toast. Returns
 * whether it worked; failures are toasted here.
 */
export async function completeWithUndo(
  task: Pick<Task, "id">,
  message: string,
  source: "manual" | "qr" = "manual",
): Promise<boolean> {
  try {
    const { completion } = await api.call(endpoints.tasksComplete, {
      params: { id: task.id },
      body: { source },
    });
    await invalidateAll();
    toast.success(message, {
      duration: TOAST_MS,
      action: {
        label: m.common_undo(),
        onClick: async () => {
          try {
            await api.call(endpoints.completionsUndo, {
              params: { id: completion.id },
            });
            await invalidateAll();
            toast.success(m.common_undone());
          } catch (err) {
            toast.error(apiErrorMessage(err));
          }
        },
      },
    });
    return true;
  } catch (err) {
    toast.error(apiErrorMessage(err));
    return false;
  }
}
