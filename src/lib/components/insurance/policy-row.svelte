<script lang="ts">
  import type { InsurancePolicy } from "$lib/api/schemas/insurance";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { formatMoney } from "$lib/format-money";
  import {
    insuranceTypeIcons,
    insuranceTypeLabels,
  } from "$lib/insurance/labels";
  import { insuranceHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import DeadlineHint from "./deadline-hint.svelte";

  let { policy, today }: { policy: InsurancePolicy; today: string } = $props();

  const Icon = $derived(insuranceTypeIcons[policy.type]);
  const subtitle = $derived(
    [policy.insurerName, policy.policyNumber].filter(Boolean).join(" · "),
  );
  const covers = $derived(policy.assets.map((asset) => asset.name).join(", "));
</script>

<li>
  <a
    href={insuranceHref(policy.id)}
    class="hover:bg-accent/50 focus-visible:ring-ring/50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 transition-colors outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-[3px]"
  >
    <span
      class="bg-muted text-muted-foreground mt-0.5 flex size-9 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Icon class="size-4.5" />
    </span>
    <span class="min-w-0">
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-sm font-medium text-pretty wrap-anywhere"
          >{policy.title}</span
        >
        {#if policy.archivedAt}
          <Badge variant="secondary">{m.insurance_archived()}</Badge>
        {/if}
      </span>
      <span class="text-muted-foreground mt-0.5 block text-xs wrap-anywhere">
        {insuranceTypeLabels[policy.type]()}{subtitle ? ` · ${subtitle}` : ""}
      </span>
      {#if covers}
        <span class="text-muted-foreground mt-0.5 block truncate text-xs">
          {m.insurance_covers({ assets: covers })}
        </span>
      {/if}
    </span>
    <span class="flex flex-col items-end gap-0.5 text-end">
      <span class="text-sm font-medium whitespace-nowrap tabular-nums"
        >{formatMoney(policy.annualPremiumMinor, policy.currency)}</span
      >
      <span class="text-muted-foreground text-xs"
        >{m.insurance_per_annual()}</span
      >
    </span>
    <span class="col-span-3 flex items-center justify-between gap-3 ps-12">
      {#if !policy.archivedAt}
        <DeadlineHint deadline={policy.cancellationDeadline} {today} />
      {:else}
        <span></span>
      {/if}
      <CommentCount count={policy.commentCount} class="shrink-0" />
    </span>
  </a>
</li>
