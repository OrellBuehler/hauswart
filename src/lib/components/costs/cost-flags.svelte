<script lang="ts">
  import EyeIcon from "@lucide/svelte/icons/eye";
  import type { CostEntry } from "$lib/api/schemas/costs";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import { hasCostFlags } from "./cost-flags";

  let {
    cost,
    recurrenceHref,
    class: className,
  }: {
    cost: Pick<
      CostEntry,
      "amountMinor" | "countsAsExpense" | "source" | "reviewNeeded"
    >;
    /** Where the recurring cost that booked the entry is; the badge is a link then (not in a row that is a link itself). */
    recurrenceHref?: string | undefined;
    class?: string;
  } = $props();
</script>

{#if hasCostFlags(cost)}
  <span class={cn("flex flex-wrap items-center gap-1.5", className)}>
    {#if cost.reviewNeeded}
      <Badge variant="outline" class="border-warning/50 text-warning">
        <EyeIcon aria-hidden="true" />{m.cost_badge_review()}
      </Badge>
    {/if}
    {#if cost.amountMinor < 0}
      <Badge variant="outline" class="border-success/40 text-success"
        >{m.cost_badge_refund()}</Badge
      >
    {/if}
    {#if !cost.countsAsExpense}
      <Badge variant="secondary">{m.cost_badge_equity()}</Badge>
    {/if}
    {#if cost.source === "recurring"}
      <Badge variant="outline" href={recurrenceHref}
        >{m.cost_badge_recurring()}</Badge
      >
    {:else if cost.source !== "manual"}
      <Badge variant="outline">{m.cost_badge_imported()}</Badge>
    {/if}
  </span>
{/if}
