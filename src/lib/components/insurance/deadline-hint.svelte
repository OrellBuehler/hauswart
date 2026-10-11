<script lang="ts">
  import ClockAlertIcon from "@lucide/svelte/icons/clock-alert";
  import { deadlineInfo, deadlineTones } from "$lib/insurance/deadline";
  import { formatDateShort, formatRelativeDays } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    deadline,
    today,
    class: className,
  }: {
    /** The cancellation deadline (`YYYY-MM-DD`), or null for a policy without one. */
    deadline: string | null;
    today: string;
    class?: string;
  } = $props();

  const info = $derived(deadlineInfo(deadline, today));
</script>

{#if deadline && info}
  <span
    class={cn(
      "inline-flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums",
      deadlineTones[info.tone],
      className,
    )}
  >
    {#if info.tone === "overdue"}
      <ClockAlertIcon class="size-3.5" aria-hidden="true" />
      <span>{m.insurance_deadline_overdue()}</span>
      <span aria-hidden="true">·</span>
      <span>{formatDateShort(deadline, { today })}</span>
      <span aria-hidden="true">·</span>
      <span>{formatRelativeDays(info.days)}</span>
    {:else}
      <span
        >{m.insurance_deadline_cancel_by({
          date: formatDateShort(deadline, { today }),
        })}</span
      >
      <span aria-hidden="true">·</span>
      <span>{formatRelativeDays(info.days)}</span>
    {/if}
  </span>
{:else}
  <span class={cn("text-muted-foreground text-xs", className)}
    >{m.insurance_deadline_none()}</span
  >
{/if}
