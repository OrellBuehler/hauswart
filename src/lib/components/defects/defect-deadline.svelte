<script lang="ts">
  import ClockAlertIcon from "@lucide/svelte/icons/clock-alert";
  import type { DefectStatus } from "$lib/api/enums";
  import { deadlineInfo, deadlineTones } from "$lib/defects/deadline";
  import { formatDateShort, formatRelativeDays } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    date,
    status,
    today,
    labelled = false,
    class: className,
  }: {
    date: string | null;
    status: DefectStatus;
    today: string;
    labelled?: boolean;
    class?: string;
  } = $props();

  const info = $derived(deadlineInfo(date, status, today));
</script>

{#if date && info}
  <span
    class={cn(
      "inline-flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums",
      deadlineTones[info.tone],
      className,
    )}
  >
    {#if labelled}
      <span class="text-muted-foreground">{m.defect_deadline()}:</span>
    {/if}
    {#if info.tone === "overdue"}
      <ClockAlertIcon class="size-3.5" aria-hidden="true" />
      <span>{m.defect_deadline_overdue()}</span>
      <span aria-hidden="true">·</span>
    {/if}
    <span>{formatDateShort(date, { today })}</span>
    <span aria-hidden="true">·</span>
    <span>{formatRelativeDays(info.days)}</span>
  </span>
{:else}
  <span class={cn("text-muted-foreground text-xs", className)}
    >{m.defect_deadline_none()}</span
  >
{/if}
