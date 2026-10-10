<script lang="ts">
  import type { Component } from "svelte";
  import type { CostsSummary } from "$lib/api/schemas/costs";
  import * as Card from "$lib/components/ui/card/index.js";
  import type { CostFilters } from "$lib/costs/filters";
  import {
    categoryIcons,
    categoryLabels,
    deductibleLabels,
  } from "$lib/costs/labels";
  import { hasSettlementData } from "$lib/costs/summary";
  import { formatPercent, monthName } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    summary,
    activeMonth = "",
    onfilter,
  }: {
    summary: CostsSummary;
    /** `01` to `12` when the list is narrowed to a month. */
    activeMonth?: string;
    /** Narrows the list: the person picked a category, month or device here. */
    onfilter: (patch: Partial<CostFilters>) => void;
  } = $props();

  const money = (value: number) => formatMoney(value, summary.currency);
  const total = $derived(summary.expenseTotalMinor);
  const share = (value: number) =>
    total > 0 ? formatPercent(Math.round((value / total) * 10_000)) : null;
  const barWidth = (value: number, max: number) =>
    max > 0 ? Math.max(2, Math.round((Math.abs(value) / max) * 100)) : 0;

  const maxCategory = $derived(
    Math.max(0, ...summary.byCategory.map((c) => Math.abs(c.totalMinor))),
  );
  const maxAsset = $derived(
    Math.max(0, ...summary.byAsset.map((a) => Math.abs(a.totalMinor))),
  );
  const maxTax = $derived(
    Math.max(0, ...summary.byDeductible.map((d) => Math.abs(d.totalMinor))),
  );
  const maxMonth = $derived(
    Math.max(0, ...summary.byMonth.map((x) => Math.abs(x.totalMinor))),
  );
  const empty = $derived(
    summary.byCategory.length === 0 &&
      summary.byMonth.every((x) => x.count === 0),
  );
  const taxRows = $derived(
    summary.byDeductible.filter((d) => d.count > 0 || d.totalMinor !== 0),
  );
</script>

{#snippet bar(value: number, max: number)}
  <span class="bg-muted block h-1.5 flex-1 overflow-hidden rounded-full">
    <span
      class={cn(
        "block h-full rounded-full",
        value < 0 ? "bg-success" : "bg-brand",
      )}
      style="width: {barWidth(value, max)}%"
    ></span>
  </span>
{/snippet}

{#snippet row(
  label: string,
  value: number,
  max: number,
  Icon: Component | undefined,
  onclick: (() => void) | undefined,
  percent: string | null,
  active: boolean = false,
)}
  {#if onclick}
    <button
      type="button"
      class={cn(
        "hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex w-[calc(100%+1rem)] flex-col gap-1.5 rounded-lg px-2 py-2 text-start transition-colors outline-none focus-visible:ring-[3px]",
        active && "bg-accent",
      )}
      aria-pressed={active ? true : undefined}
      {onclick}
    >
      {@render rowBody(label, value, max, Icon, percent)}
    </button>
  {:else}
    <div class="flex flex-col gap-1.5 py-2">
      {@render rowBody(label, value, max, Icon, percent)}
    </div>
  {/if}
{/snippet}

{#snippet rowBody(
  label: string,
  value: number,
  max: number,
  Icon: Component | undefined,
  percent: string | null,
)}
  <span class="flex items-baseline justify-between gap-3 text-sm">
    <span class="flex min-w-0 items-center gap-2">
      {#if Icon}
        <Icon
          class="text-muted-foreground size-4 shrink-0 self-center"
          aria-hidden="true"
        />
      {/if}
      <span class="break-words">{label}</span>
    </span>
    <span class="shrink-0 font-medium whitespace-nowrap tabular-nums"
      >{money(value)}</span
    >
  </span>
  <span class="flex items-center gap-2">
    {@render bar(value, max)}
    <span
      class="text-muted-foreground w-16 shrink-0 text-end text-xs whitespace-nowrap tabular-nums"
      >{percent === null ? "" : m.cost_percent({ value: percent })}</span
    >
  </span>
{/snippet}

{#if empty}
  <p
    class="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm"
  >
    {m.costs_report_empty({ year: summary.year })}
  </p>
{:else}
  <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
    <Card.Root class="gap-3 lg:col-span-2">
      <Card.Header>
        <Card.Title class="text-base">{m.costs_by_month()}</Card.Title>
        <Card.Description>{m.costs_by_month_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        <ul class="flex flex-col sm:hidden" aria-label={m.costs_by_month()}>
          {#each summary.byMonth as entry (entry.month)}
            {@const number = Number(entry.month.slice(5, 7))}
            {@const key = entry.month.slice(5, 7)}
            {#if entry.count > 0 || activeMonth === key}
              <li>
                {@render row(
                  monthName(number),
                  entry.totalMinor,
                  maxMonth,
                  undefined,
                  () => onfilter({ month: activeMonth === key ? "" : key }),
                  share(entry.totalMinor),
                  activeMonth === key,
                )}
              </li>
            {/if}
          {/each}
        </ul>
        <div
          class="grid h-40 grid-cols-12 items-stretch gap-1 max-sm:hidden"
          role="group"
          aria-label={m.costs_by_month()}
        >
          {#each summary.byMonth as entry (entry.month)}
            {@const number = Number(entry.month.slice(5, 7))}
            {@const key = entry.month.slice(5, 7)}
            <button
              type="button"
              class={cn(
                "hover:bg-accent/60 focus-visible:ring-ring/50 flex min-w-0 flex-col items-stretch justify-end gap-1 rounded-md px-0.5 pt-1 pb-0.5 outline-none focus-visible:ring-[3px]",
                activeMonth === key && "bg-accent",
              )}
              aria-pressed={activeMonth === key}
              aria-label={`${monthName(number)}: ${money(entry.totalMinor)}`}
              title={`${monthName(number)}: ${money(entry.totalMinor)}`}
              onclick={() =>
                onfilter({ month: activeMonth === key ? "" : key })}
            >
              <span class="flex flex-1 items-end">
                <span
                  class={cn(
                    "block w-full rounded-t-sm",
                    entry.count === 0
                      ? "bg-muted h-0.5"
                      : entry.totalMinor < 0
                        ? "bg-success"
                        : "bg-brand",
                  )}
                  style={entry.count === 0
                    ? undefined
                    : `height: ${barWidth(entry.totalMinor, maxMonth)}%`}
                ></span>
              </span>
              <span class="text-muted-foreground text-center text-xs"
                >{monthName(number, "short").slice(0, 1)}</span
              >
            </button>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="gap-3">
      <Card.Header>
        <Card.Title class="text-base">{m.costs_by_category()}</Card.Title>
        <Card.Description>{m.costs_by_category_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if summary.byCategory.length === 0}
          <p class="text-muted-foreground text-sm">{m.costs_nothing_here()}</p>
        {:else}
          <ul class="flex flex-col">
            {#each summary.byCategory as entry (entry.category)}
              <li>
                {@render row(
                  categoryLabels[entry.category](),
                  entry.totalMinor,
                  maxCategory,
                  categoryIcons[entry.category],
                  () => onfilter({ category: entry.category }),
                  share(entry.totalMinor),
                )}
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>

    <div class="flex min-w-0 flex-col gap-4">
      <Card.Root class="gap-3">
        <Card.Header>
          <Card.Title class="text-base">{m.costs_by_asset()}</Card.Title>
          <Card.Description>{m.costs_by_asset_hint()}</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if summary.byAsset.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.costs_nothing_here()}
            </p>
          {:else}
            <ul class="flex flex-col">
              {#each summary.byAsset as entry (entry.assetId)}
                <li>
                  {@render row(
                    entry.assetName,
                    entry.totalMinor,
                    maxAsset,
                    undefined,
                    () => onfilter({ assetId: entry.assetId }),
                    share(entry.totalMinor),
                  )}
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
      <Card.Root class="gap-3">
        <Card.Header>
          <Card.Title class="text-base">{m.costs_by_tax()}</Card.Title>
          <Card.Description>{m.costs_by_tax_hint()}</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if taxRows.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.costs_nothing_here()}
            </p>
          {:else}
            <ul class="flex flex-col">
              {#each taxRows as entry (entry.deductible)}
                <li>
                  {@render row(
                    deductibleLabels[entry.deductible](),
                    entry.totalMinor,
                    maxTax,
                    undefined,
                    undefined,
                    share(entry.totalMinor),
                  )}
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
    </div>

    <Card.Root class="gap-3 lg:col-span-2">
      <Card.Header>
        <Card.Title class="text-base">{m.costs_people_title()}</Card.Title>
        <Card.Description>{m.costs_people_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if !hasSettlementData(summary)}
          <p class="text-muted-foreground text-sm">
            {m.costs_settlement_nothing()}
          </p>
        {:else}
          <ul class="divide-y">
            {#each summary.people as person (person.userId)}
              <li class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <span class="text-sm font-medium break-words"
                  >{person.userName ?? m.cost_person_unknown()}</span
                >
                <dl class="grid gap-1.5 text-sm sm:grid-cols-3 sm:gap-3">
                  <div
                    class="flex items-baseline justify-between gap-3 sm:block"
                  >
                    <dt class="text-muted-foreground text-xs">
                      {m.costs_paid()}
                    </dt>
                    <dd class="whitespace-nowrap tabular-nums sm:mt-0.5">
                      {money(person.paidMinor)}
                    </dd>
                  </div>
                  <div
                    class="flex items-baseline justify-between gap-3 sm:block"
                  >
                    <dt class="text-muted-foreground text-xs">
                      {m.costs_share()}
                    </dt>
                    <dd class="whitespace-nowrap tabular-nums sm:mt-0.5">
                      {money(person.shareMinor)}
                    </dd>
                  </div>
                  <div
                    class="flex items-baseline justify-between gap-3 sm:block"
                  >
                    <dt class="text-muted-foreground text-xs">
                      {m.costs_balance()}
                    </dt>
                    <dd
                      class={cn(
                        "font-medium whitespace-nowrap tabular-nums sm:mt-0.5",
                        person.balanceMinor > 0 && "text-success",
                        person.balanceMinor < 0 && "text-destructive",
                      )}
                    >
                      {person.balanceMinor > 0 ? "+" : ""}{money(
                        person.balanceMinor,
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
{/if}
