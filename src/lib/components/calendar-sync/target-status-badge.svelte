<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import CirclePauseIcon from "@lucide/svelte/icons/circle-pause";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import UnplugIcon from "@lucide/svelte/icons/unplug";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import type { TargetState } from "$lib/calendar-sync/health";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let { state, class: className }: { state: TargetState; class?: string } =
    $props();

  const view = $derived.by(() => {
    switch (state) {
      case "ok":
        return {
          icon: CircleCheckIcon,
          label: m.caltargets_status_ok(),
          tone: "bg-success/12 text-success border-transparent",
        };
      case "error":
        return {
          icon: CircleXIcon,
          label: m.caltargets_status_error(),
          tone: "bg-destructive/10 text-destructive border-transparent",
        };
      case "waiting":
        return {
          icon: CircleDashedIcon,
          label: m.caltargets_status_waiting(),
          tone: "bg-warning/15 text-warning border-transparent",
        };
      case "offline":
        return {
          icon: UnplugIcon,
          label: m.caltargets_status_offline(),
          tone: "bg-warning/15 text-warning border-transparent",
        };
      case "paused":
        return {
          icon: CirclePauseIcon,
          label: m.caltargets_status_paused(),
          tone: "bg-muted text-muted-foreground border-transparent",
        };
    }
  });
</script>

<Badge
  variant="outline"
  class={cn("gap-1.5 px-2.5 py-1", view.tone, className)}
>
  <view.icon aria-hidden="true" />
  {view.label}
</Badge>
