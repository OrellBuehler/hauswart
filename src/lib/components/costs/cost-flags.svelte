<script lang="ts">
  import type { CostEntry } from "$lib/api/schemas/costs";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    cost,
    class: className,
  }: {
    cost: Pick<CostEntry, "amountMinor" | "countsAsExpense" | "source">;
    class?: string;
  } = $props();
</script>

{#if cost.amountMinor < 0 || !cost.countsAsExpense || cost.source !== "manual"}
  <span class={cn("flex flex-wrap items-center gap-1.5", className)}>
    {#if cost.amountMinor < 0}
      <Badge variant="outline" class="border-success/40 text-success"
        >{m.cost_badge_refund()}</Badge
      >
    {/if}
    {#if !cost.countsAsExpense}
      <Badge variant="secondary">{m.cost_badge_equity()}</Badge>
    {/if}
    {#if cost.source !== "manual"}
      <Badge variant="outline">{m.cost_badge_imported()}</Badge>
    {/if}
  </span>
{/if}
