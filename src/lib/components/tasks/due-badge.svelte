<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import { dueWording } from "$lib/tasks/row";
  import { statusLabels } from "$lib/tasks/labels";
  import type { DueStatus } from "$lib/tasks/engine/types";
  import { cn } from "$lib/utils";
  import StatusDot from "./status-dot.svelte";
  import { statusTones } from "./tones";

  let {
    status,
    date,
    estimated = false,
    today,
    class: className,
  }: {
    status: DueStatus;
    date: string | null;
    estimated?: boolean;
    today: string;
    class?: string;
  } = $props();

  const wording = $derived(date ? dueWording(date, today) : null);
</script>

<span
  class={cn(
    "inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
    className,
  )}
>
  <span
    class={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
      statusTones[status].pill,
    )}
  >
    <StatusDot {status} />
    {statusLabels[status]()}
  </span>
  {#if wording}
    <span
      class="text-muted-foreground tabular-nums"
      title={estimated ? m.due_estimated_hint() : undefined}
    >
      {#if estimated}<span aria-hidden="true">~ </span><span class="sr-only"
          >{m.due_estimated_sr()}
        </span>{/if}{wording.relative} · {wording.absolute}
    </span>
  {/if}
</span>
