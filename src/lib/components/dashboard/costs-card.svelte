<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CoinsIcon from "@lucide/svelte/icons/coins";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { resolve } from "$app/paths";
  import type { CostBalances } from "$lib/api/schemas/costs";
  import type { Dashboard } from "$lib/api/schemas/dashboard";
  import SuggestedPayments from "$lib/components/costs/suggested-payments.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import {
    balanceState,
    viewerLine,
    type BalanceTone,
  } from "$lib/costs/balances";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    costs,
    balances,
    userId,
  }: {
    costs: Dashboard["costsYearToDate"];
    /** Where everybody stands across all books; `null` when they could not be read. */
    balances: CostBalances | null;
    userId: string;
  } = $props();

  const status = $derived(balances ? balanceState(balances) : "empty");
  const you = $derived(balances ? viewerLine(balances, userId) : null);
  const tones: Record<BalanceTone, string> = {
    credit: "text-success",
    debit: "text-destructive",
    even: "",
  };
  const payments = $derived(balances?.suggestedPayments.slice(0, 3) ?? []);
</script>

{#if costs.totalMinor !== 0 || status !== "empty"}
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2 text-base">
        <CoinsIcon class="text-muted-foreground size-4" aria-hidden="true" />
        {m.costs_title()}
      </Card.Title>
      {#if you}
        <Card.Description>{m.dashboard_costs_balance_hint()}</Card.Description>
      {/if}
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      {#if balances === null}
        <p class="text-muted-foreground flex items-start gap-2 text-sm">
          <TriangleAlertIcon
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          {m.balances_unavailable()}
        </p>
      {/if}
      {#if you}
        <p class={cn("text-xl font-semibold tabular-nums", tones[you.tone])}>
          {you.text}
        </p>
      {/if}
      {#if balances && status === "open"}
        <SuggestedPayments
          class="text-sm"
          {payments}
          currency={balances.currency}
        />
      {:else if status === "square"}
        <p class="flex items-start gap-2 text-sm text-pretty">
          <CircleCheckIcon
            class="text-success mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          {m.balances_square()}
        </p>
      {/if}
      <p
        class="flex items-baseline justify-between gap-3 border-t pt-3 text-sm"
      >
        <span class="text-muted-foreground"
          >{m.dashboard_costs_year({ year: costs.year })}</span
        >
        <span class="font-medium whitespace-nowrap tabular-nums"
          >{formatMoney(costs.totalMinor, costs.currency)}</span
        >
      </p>
      <div class="flex flex-wrap gap-x-4">
        <a
          href={resolve("/costs/balances")}
          class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
        >
          {m.balances_open()}
          <ArrowRightIcon class="size-4" aria-hidden="true" />
        </a>
        <a
          href={resolve("/costs")}
          class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
        >
          {m.dashboard_to_costs()}
          <ArrowRightIcon class="size-4" aria-hidden="true" />
        </a>
      </div>
    </Card.Content>
  </Card.Root>
{/if}
