<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronsUpIcon from "@lucide/svelte/icons/chevrons-up";
  import EqualIcon from "@lucide/svelte/icons/equal";
  import type { DefectSeverity } from "$lib/api/enums";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { severityLabels, severityTones } from "$lib/defects/labels";
  import { cn } from "$lib/utils";

  let {
    severity,
    class: className,
  }: { severity: DefectSeverity; class?: string } = $props();

  const icons = {
    high: ChevronsUpIcon,
    medium: EqualIcon,
    low: ChevronDownIcon,
  };
  const Icon = $derived(icons[severity]);
</script>

<Badge variant="outline" class={cn(severityTones[severity], className)}>
  <Icon aria-hidden="true" />
  {severityLabels[severity]()}
</Badge>
