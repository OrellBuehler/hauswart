<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import InfoIcon from "@lucide/svelte/icons/info";
  import FilterIcon from "@lucide/svelte/icons/list-filter";
  import type { CostBalances, CostsSummary } from "$lib/api/schemas/costs";
  import * as Card from "$lib/components/ui/card/index.js";
  import { viewerLine } from "$lib/costs/balances";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import BalanceOverview from "./balance-overview.svelte";

  let {
    summary,
    balances,
    userId,
    balancesHref,
    asset,
    bookName,
    reviewHref,
  }: {
    summary: CostsSummary;
    /** Where everybody stands today (the book on screen, or every book); `null` when they could not be read. */
    balances: CostBalances | null;
    userId: string;
    /** The Saldo page, with the same book. */
    balancesHref: string;
    /** Set when the summary was asked for one device only; `name` is null when that device is not known here. */
    asset?: { name: string | null } | undefined;
    /** Set when the summary was asked for one book only. */
    bookName?: string | undefined;
    /**
     * The list of the entries still to review in the summary's scope. The notice only shows while the summary counts
     * some; leave it out where that list is on screen already.
     */
    reviewHref?: string | undefined;
  } = $props();

  const entryCount = $derived(
    summary.byMonth.reduce((sum, month) => sum + month.count, 0),
  );
  const money = (value: number) => formatMoney(value, summary.currency);
  const you = $derived(balances ? viewerLine(balances, userId) : null);
  const tones = {
    credit: "text-success",
    debit: "text-destructive",
    even: "",
  } as const;
  const balanceTitle = $derived(
    bookName
      ? `${m.balances_teaser_title()} · ${bookName}`
      : m.balances_teaser_title(),
  );
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

<div class="flex flex-col gap-3">
  {#if reviewHref && summary.reviewNeededCount > 0}
    <!-- eslint-disable svelte/no-navigation-without-resolve -- the page hands over the resolved address -->
    <a
      href={reviewHref}
      class="border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 focus-visible:ring-ring/50 flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px]"
    >
      <EyeIcon class="size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 text-pretty">
        {m.costs_review_banner({ count: summary.reviewNeededCount })}
      </span>
      <span class="flex shrink-0 items-center gap-1 text-xs">
        {m.costs_review_open()}
        <ArrowRightIcon class="size-3.5" aria-hidden="true" />
      </span>
    </a>
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  {/if}
  {#if asset || bookName}
    <p
      class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-pretty"
    >
      <FilterIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 wrap-anywhere">
        {#if asset}
          {asset.name
            ? m.costs_summary_asset({ name: asset.name })
            : m.costs_summary_asset_unknown()}
        {:else if bookName}
          {m.costs_summary_book({ name: bookName })}
        {/if}
      </span>
    </p>
  {/if}

  <Card.Root class="gap-3 py-4 lg:hidden">
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
        <h3 class="text-sm font-medium">{balanceTitle}</h3>
        <p class="text-muted-foreground -mt-1.5 text-xs">
          {m.balances_teaser_hint()}
        </p>
        {#if you}
          <p class={cn("text-lg font-semibold tabular-nums", tones[you.tone])}>
            {you.text}
          </p>
        {/if}
        <BalanceOverview
          {balances}
          {userId}
          href={balancesHref}
          showYou={false}
        />
      </section>
    </Card.Content>
  </Card.Root>

  <div class="grid grid-cols-1 gap-4 max-lg:hidden lg:grid-cols-2">
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
        <Card.Description>{balanceTitle}</Card.Description>
        <Card.Title
          class={cn(
            "text-3xl font-semibold tabular-nums",
            you ? tones[you.tone] : "text-muted-foreground",
          )}
        >
          {you ? you.text : m.balances_teaser_title()}
        </Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3 text-sm">
        <p class="text-muted-foreground -mt-1 text-xs">
          {m.balances_teaser_hint()}
        </p>
        <BalanceOverview
          {balances}
          {userId}
          href={balancesHref}
          showYou={false}
        />
      </Card.Content>
    </Card.Root>
  </div>
</div>
