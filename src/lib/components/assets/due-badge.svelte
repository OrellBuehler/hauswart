<script lang="ts">
  import type { TaskState } from "$lib/api/schemas/tasks";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { shownDate, shownDateIsEstimate } from "$lib/tasks/engine/shown";
  import { cn } from "$lib/utils";

  let {
    state,
    class: className,
  }: {
    state: TaskState | null;
    class?: string;
  } = $props();

  const status = $derived(state?.status ?? "unknown");
  const labels = {
    overdue: () => m.due_overdue(),
    due: () => m.due_due(),
    open: () => m.due_open(),
    ok: () => m.due_ok(),
    snoozed: () => m.due_snoozed(),
    unknown: () => m.due_unknown(),
  };
  const tones = {
    overdue: "border-destructive/30 bg-destructive/10 text-destructive",
    due: "border-warning/40 bg-warning/10 text-warning",
    open: "border-warning/40 bg-warning/10 text-warning",
    ok: "border-success/30 bg-success/10 text-success",
    snoozed: "text-muted-foreground",
    unknown: "text-muted-foreground",
  };
  const shown = $derived(state ? shownDate(state) : null);
  const date = $derived(
    state && shown
      ? shownDateIsEstimate(state)
        ? m.due_estimated_date({ date: formatDay(shown) })
        : formatDay(shown)
      : undefined,
  );
</script>

<span
  class={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}
>
  <Badge variant="outline" class={cn("font-medium", tones[status])}>
    {labels[status]()}
  </Badge>
  {#if date}
    <span class="text-muted-foreground text-xs tabular-nums">{date}</span>
  {/if}
</span>
