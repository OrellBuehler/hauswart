<script lang="ts">
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import ShieldQuestionMarkIcon from "@lucide/svelte/icons/shield-question-mark";
  import ShieldXIcon from "@lucide/svelte/icons/shield-x";
  import type { WarrantyInfo, WarrantyStatus } from "$lib/assets/warranty";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    info,
    class: className,
  }: {
    info: WarrantyInfo;
    class?: string;
  } = $props();

  const tones: Record<WarrantyStatus, string> = {
    valid: "border-success/30 bg-success/10 text-success",
    expiring: "border-warning/40 bg-warning/10 text-warning",
    expired: "border-destructive/30 bg-destructive/10 text-destructive",
    unknown: "text-muted-foreground",
  };
  const icons = {
    valid: ShieldCheckIcon,
    expiring: ShieldAlertIcon,
    expired: ShieldXIcon,
    unknown: ShieldQuestionMarkIcon,
  };

  const Icon = $derived(icons[info.status]);
  const date = $derived(info.until ? formatDay(info.until) : "");
  const label = $derived(
    info.status === "valid"
      ? m.warranty_valid({ date })
      : info.status === "expiring"
        ? m.warranty_expiring({ date })
        : info.status === "expired"
          ? m.warranty_expired({ date })
          : m.warranty_unknown(),
  );
  const detail = $derived(
    info.daysLeft === null
      ? undefined
      : info.daysLeft < 0
        ? m.warranty_days_ago({ days: -info.daysLeft })
        : info.daysLeft === 0
          ? m.warranty_today()
          : m.warranty_days_left({ days: info.daysLeft }),
  );
</script>

<Badge
  variant="outline"
  class={cn("font-medium", tones[info.status], className)}
  title={detail}
>
  <Icon aria-hidden="true" />
  {label}
</Badge>
