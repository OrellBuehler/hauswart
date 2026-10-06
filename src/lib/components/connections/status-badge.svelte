<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import CirclePauseIcon from "@lucide/svelte/icons/circle-pause";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import type { Integration } from "$lib/api/schemas/integrations";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    integration,
    class: className,
  }: { integration: Integration; class?: string } = $props();

  const view = $derived.by(() => {
    if (!integration.available) {
      return {
        icon: CircleDashedIcon,
        label: m.integration_status_soon(),
        tone: "bg-muted text-muted-foreground border-transparent",
      };
    }
    if (!integration.configured) {
      return {
        icon: CircleDashedIcon,
        label: m.integration_status_not_connected(),
        tone: "bg-muted text-muted-foreground border-transparent",
      };
    }
    if (!integration.enabled) {
      return {
        icon: CirclePauseIcon,
        label: m.integration_status_paused(),
        tone: "bg-muted text-muted-foreground border-transparent",
      };
    }
    switch (integration.status) {
      case "ok":
        return {
          icon: CircleCheckIcon,
          label: m.integration_status_ok(),
          tone: "bg-success/12 text-success border-transparent",
        };
      case "error":
        return {
          icon: CircleXIcon,
          label: m.integration_status_error(),
          tone: "bg-destructive/10 text-destructive border-transparent",
        };
      default:
        return {
          icon: CircleHelpIcon,
          label: m.integration_status_unknown(),
          tone: "bg-warning/15 text-warning border-transparent",
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
