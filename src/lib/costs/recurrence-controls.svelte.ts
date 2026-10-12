import { toast } from "svelte-sonner";
import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { CostRecurrence } from "$lib/api/schemas/cost-recurrences";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";
import {
  recurrenceBookClosed,
  resumeMessage,
  runNowMessage,
} from "./recurrences";

export type RecurrenceAction = "pause" | "resume" | "run";

/**
 * Pause, resume and "book now" of recurring costs, with their pending and error state. One action runs at a time (a second
 * tap meanwhile does nothing); the page is told when the answer changed something, so that it loads again.
 */
export class RecurrenceControls {
  /** The action in progress and the recurring cost it is for. */
  busy = $state<{ id: string; action: RecurrenceAction } | null>(null);
  /** Why the last action failed. */
  error = $state<string | undefined>();

  constructor(
    private readonly options: {
      onchanged: () => Promise<void> | void;
      /** Opens an entry, for the toast after "book now". */
      viewEntry: (entryId: string) => void;
    },
  ) {}

  private async perform(
    recurrence: CostRecurrence,
    action: RecurrenceAction,
    call: () => Promise<void>,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = { id: recurrence.id, action };
    this.error = undefined;
    try {
      await call();
      await this.options.onchanged();
    } catch (err) {
      this.error =
        action === "run" && recurrenceBookClosed(err)
          ? m.recurrence_error_book_archived({ book: recurrence.bookName })
          : apiErrorMessage(err);
      toast.error(this.error);
      // The server may have recorded the failure on the recurring cost.
      await this.options.onchanged();
    } finally {
      this.busy = null;
    }
  }

  pause(recurrence: CostRecurrence): Promise<void> {
    return this.perform(recurrence, "pause", async () => {
      await api.call(endpoints.costRecurrencesUpdate, {
        params: { id: recurrence.id },
        body: { active: false },
      });
      toast.success(m.recurrence_paused_toast({ title: recurrence.title }));
    });
  }

  resume(recurrence: CostRecurrence): Promise<void> {
    return this.perform(recurrence, "resume", async () => {
      const resumed = await api.call(endpoints.costRecurrencesUpdate, {
        params: { id: recurrence.id },
        body: { active: true },
      });
      toast.success(resumeMessage(resumed));
    });
  }

  run(recurrence: CostRecurrence): Promise<void> {
    return this.perform(recurrence, "run", async () => {
      const result = await api.call(endpoints.costRecurrencesRun, {
        params: { id: recurrence.id },
      });
      const message = runNowMessage(result);
      if (result.entry) {
        const entryId = result.entry.id;
        toast.success(message.text, {
          action: {
            label: m.finance_view(),
            onClick: () => this.options.viewEntry(entryId),
          },
        });
      } else {
        toast.info(message.text);
      }
    });
  }
}
