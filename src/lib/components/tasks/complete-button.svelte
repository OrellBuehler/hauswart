<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import CompleteOdometerDialog from "$lib/components/vehicles/complete-odometer-dialog.svelte";
  import { Button, type ButtonProps } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { completeTask } from "$lib/tasks/actions";
  import type { Trigger } from "$lib/tasks/engine/types";
  import { odometerAssetOf } from "$lib/tasks/odometer-task";
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
    task: {
      id: string;
      title: string;
      assetId?: string | null | undefined;
      trigger?: Trigger | undefined;
    };
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
  let odometerAssetId = $state<string | undefined>();
  let dialogOpen = $state(false);

  async function run() {
    if (pending) return;
    pending = true;
    try {
      let vehicleId: string | null;
      try {
        vehicleId = await odometerAssetOf(task);
      } catch (err) {
        toast.error(apiErrorMessage(err));
        return;
      }
      if (vehicleId) {
        odometerAssetId = vehicleId;
        dialogOpen = true;
        return;
      }
      onstart?.();
      try {
        await completeTask(task);
      } catch (err) {
        onfail?.();
        toast.error(apiErrorMessage(err));
      } finally {
        onsettled?.();
      }
    } finally {
      pending = false;
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

{#if odometerAssetId}
  <CompleteOdometerDialog
    bind:open={dialogOpen}
    {task}
    assetId={odometerAssetId}
    {onsettled}
  />
{/if}
