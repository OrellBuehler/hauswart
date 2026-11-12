<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import FlagIcon from "@lucide/svelte/icons/flag";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import {
    recurrenceStateLabels,
    type RecurrenceState,
  } from "#lib/costs/recurrences.ts";
  import { cn } from "#lib/utils.ts";

  let { state, class: className }: { state: RecurrenceState; class?: string } =
    $props();

  const icons = {
    active: CircleCheckIcon,
    paused: PauseIcon,
    finished: FlagIcon,
  } as const;
  const tones = {
    active: "border-success/40 text-success",
    paused: "border-warning/50 text-warning",
    finished: "text-muted-foreground",
  } as const;
  const Icon = $derived(icons[state]);
</script>

<Badge variant="outline" class={cn(tones[state], className)}>
  <Icon aria-hidden="true" />{recurrenceStateLabels[state]()}
</Badge>
