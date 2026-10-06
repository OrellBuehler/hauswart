<script lang="ts">
  import SignalHighIcon from "@lucide/svelte/icons/signal-high";
  import SignalLowIcon from "@lucide/svelte/icons/signal-low";
  import SignalMediumIcon from "@lucide/svelte/icons/signal-medium";
  import type { DefectSeverity } from "$lib/api/enums";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { severityLabels, severityTones } from "$lib/defects/labels";
  import { cn } from "$lib/utils";

  let {
    severity,
    class: className,
  }: { severity: DefectSeverity; class?: string } = $props();

  const icons = {
    high: SignalHighIcon,
    medium: SignalMediumIcon,
    low: SignalLowIcon,
  };
  const Icon = $derived(icons[severity]);
</script>

<Badge variant="outline" class={cn(severityTones[severity], className)}>
  <Icon aria-hidden="true" />
  {severityLabels[severity]()}
</Badge>
