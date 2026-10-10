<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import InfoIcon from "@lucide/svelte/icons/info";
  import type { CostsSummary } from "$lib/api/schemas/costs";
  import * as Card from "$lib/components/ui/card/index.js";
  import { hasSettlementData } from "$lib/costs/summary";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";

  let { summary }: { summary: CostsSummary } = $props();

  const entryCount = $derived(
    summary.byMonth.reduce((sum, month) => sum + month.count, 0),
  );
  const hasData = $derived(hasSettlementData(summary));
  const money = (value: number) => formatMoney(value, summary.currency);
  const name = (value: string | null) => value ?? m.cost_person_unknown();
</script>

{#snippet extras()}
  {#if summary.equityTotalMinor !== 0}
    <div class="flex flex-col gap-1 border-t pt-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="font-medium">{m.costs_equity_label()}</span>
        <span class="whitespace-nowrap tabular-nums"
          >{money(summary.equityTotalMinor)}</span
        >
      </div>
      <p class="text-muted-foreground text-xs text-pretty">
        {m.costs_equity_hint()}
      </p>
    </div>
  {/if}
  {#if summary.otherCurrencyCount > 0}
    <p
      class="text-muted-foreground flex items-start gap-2 border-t pt-3 text-xs text-pretty"
    >
      <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span
        >{m.costs_other_currency({
          count: summary.otherCurrencyCount,
          currency: summary.currency,
        })}</span
      >
    </p>
  {/if}
{/snippet}

{#snippet settlement()}
  {#if summary.settlement.length > 0}
    <ul
      class="flex flex-col gap-2.5"
      aria-label={m.costs_settlement_subtitle()}
    >
      {#each summary.settlement as payment (`${payment.fromUserId}:${payment.toUserId}`)}
        <li class="flex items-baseline justify-between gap-3">
          <span class="min-w-0 break-words"
            >{m.costs_settlement_who({
              from: name(payment.fromName),
              to: name(payment.toName),
            })}</span
          >
          <span class="shrink-0 font-semibold whitespace-nowrap tabular-nums"
            >{money(payment.amountMinor)}</span
          >
        </li>
      {/each}
    </ul>
  {:else if !hasData}
    <p class="text-muted-foreground flex items-start gap-2 text-pretty">
      <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {m.costs_settlement_nothing()}
    </p>
  {:else}
    <p class="flex items-start gap-2 text-pretty">
      <CircleCheckIcon
        class="text-success mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      {m.costs_settlement_even()}
    </p>
  {/if}
  {#if summary.unassignedPayerCount > 0}
    <p
      class="text-muted-foreground flex items-start gap-2 border-t pt-3 text-xs text-pretty"
    >
      <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{m.costs_unassigned({ count: summary.unassignedPayerCount })}</span>
    </p>
  {/if}
{/snippet}

<Card.Root class="gap-3 py-4 md:hidden">
  <Card.Header class="gap-0.5">
    <Card.Description>
      {m.costs_expenses_title({ year: summary.year })}
      <span aria-hidden="true">·</span>
      {m.costs_expenses_count({ count: entryCount })}
    </Card.Description>
    <Card.Title class="text-3xl font-semibold tabular-nums">
      {money(summary.expenseTotalMinor)}
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3 text-sm">
    {@render extras()}
    <section class="flex flex-col gap-2.5 border-t pt-3">
      <h3 class="text-sm font-medium">
        {m.costs_settlement_title({ year: summary.year })}
      </h3>
      {@render settlement()}
    </section>
  </Card.Content>
</Card.Root>

<div class="grid grid-cols-1 gap-4 max-md:hidden md:grid-cols-2">
  <Card.Root class="gap-4">
    <Card.Header>
      <Card.Description>
        {m.costs_expenses_title({ year: summary.year })}
      </Card.Description>
      <Card.Title class="text-3xl font-semibold tabular-nums">
        {money(summary.expenseTotalMinor)}
      </Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3 text-sm">
      <p class="text-muted-foreground">
        {m.costs_expenses_count({ count: entryCount })}
      </p>
      {@render extras()}
    </Card.Content>
  </Card.Root>

  <Card.Root class="gap-4">
    <Card.Header>
      <Card.Description>
        {m.costs_settlement_title({ year: summary.year })}
      </Card.Description>
      <Card.Title class="text-base">{m.costs_settlement_subtitle()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3 text-sm">
      {@render settlement()}
    </Card.Content>
  </Card.Root>
</div>
