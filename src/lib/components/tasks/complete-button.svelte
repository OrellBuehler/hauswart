<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { Button, type ButtonProps } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { completeTask } from "$lib/tasks/actions";
  import { cn } from "$lib/utils";

  let {
    task,
    onstart,
    onfail,
    onsettled,
    compact = false,
    class: className,
    ...rest
  }: {
    task: { id: string; title: string };
    /** Below `sm` only the check icon (a 44px square), from `sm` up the labelled button. */
    compact?: boolean;
    /** Runs before the request: the optimistic update. */
    onstart?: () => void;
    /** The request failed; take the optimistic update back. */
    onfail?: () => void;
    /** After the refreshed data has arrived (or the request failed). */
    onsettled?: () => void;
  } & Omit<ButtonProps, "onclick" | "children" | "href"> = $props();

  let pending = $state(false);

  async function run() {
    if (pending) return;
    pending = true;
    onstart?.();
    try {
      await completeTask(task);
    } catch (err) {
      onfail?.();
      toast.error(apiErrorMessage(err));
    } finally {
      pending = false;
      onsettled?.();
    }
  }
</script>

<Button
  size="lg"
  variant="outline"
  disabled={pending}
  aria-label={m.task_complete_aria({ title: task.title })}
  onclick={run}
  class={cn(
    compact && "max-sm:size-11 max-sm:min-w-11 max-sm:has-[>svg]:px-0",
    className,
  )}
  {...rest}
>
  {#if pending}
    <LoaderCircleIcon class="animate-spin" />
  {:else}
    <CheckIcon />
  {/if}
  <span class={cn(compact && "max-sm:sr-only")}>{m.task_complete()}</span>
</Button>
