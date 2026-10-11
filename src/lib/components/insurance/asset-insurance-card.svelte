<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import UmbrellaIcon from "@lucide/svelte/icons/umbrella";
  import { resolve } from "$app/paths";
  import type { InsurancePolicy } from "$lib/api/schemas/insurance";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatMoney } from "$lib/format-money";
  import { insuranceTypeLabels } from "$lib/insurance/labels";
  import { insuranceHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import DeadlineHint from "./deadline-hint.svelte";

  let {
    assetId,
    policies,
    today,
  }: {
    assetId: string;
    /** The active policies that cover the asset. */
    policies: InsurancePolicy[];
    today: string;
  } = $props();

  const newHref = $derived(
    `${resolve("/insurance/new")}?assetId=${encodeURIComponent(assetId)}`,
  );
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.asset_insurance_title()}</Card.Title>
    <Card.Action>
      <Button href={newHref} size="sm" variant="outline">
        <PlusIcon />{m.asset_insurance_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if policies.length === 0}
      <EmptyState
        icon={UmbrellaIcon}
        title={m.asset_insurance_empty_title()}
        description={m.asset_insurance_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          <Button href={newHref}>
            <PlusIcon />{m.asset_insurance_add()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each policies as policy (policy.id)}
          <li>
            <a
              href={insuranceHref(policy.id)}
              class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-1.5 px-4 py-3 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px]"
            >
              <span class="flex items-start justify-between gap-3">
                <span class="min-w-0">
                  <span class="block text-sm font-medium wrap-anywhere"
                    >{policy.title}</span
                  >
                  <span
                    class="text-muted-foreground block text-xs wrap-anywhere"
                    >{[insuranceTypeLabels[policy.type](), policy.insurerName]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                </span>
                <span class="shrink-0 text-end">
                  <span
                    class="block text-sm font-medium whitespace-nowrap tabular-nums"
                    >{formatMoney(
                      policy.annualPremiumMinor,
                      policy.currency,
                    )}</span
                  >
                  <span class="text-muted-foreground block text-xs"
                    >{m.insurance_per_annual()}</span
                  >
                </span>
              </span>
              <DeadlineHint deadline={policy.cancellationDeadline} {today} />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>
