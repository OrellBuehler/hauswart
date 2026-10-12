<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CoinsIcon from "@lucide/svelte/icons/coins";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import { resolve } from "$app/paths";
  import type { Dashboard } from "$lib/api/schemas/dashboard";
  import SuggestedPayments from "$lib/components/costs/suggested-payments.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import {
    dashboardBalanceState,
    dashboardYouLine,
    type BalanceTone,
  } from "$lib/costs/balances";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    costs,
    balances,
    canWrite = false,
  }: {
    /** What the year has cost so far: all books together and per book. */
    costs: Dashboard["costsYearToDate"];
    /** Where the caller stands across all books, and the first payments that would square everybody; null when the server could not work it out. */
    balances: Dashboard["balances"];
    /** The person may book costs: the card offers the quick entry. */
    canWrite?: boolean;
  } = $props();

  const BOOKS_SHOWN = 4;

  const status = $derived(
    balances === null ? "unavailable" : dashboardBalanceState(balances),
  );
  const you = $derived(balances === null ? null : dashboardYouLine(balances));
  const tones: Record<BalanceTone, string> = {
    credit: "text-success",
    debit: "text-destructive",
    even: "",
  };
  const morePayments = $derived(
    balances === null
      ? 0
      : Math.max(
          0,
          balances.suggestedPaymentCount - balances.suggestedPayments.length,
        ),
  );
  const books = $derived(costs.byBook.slice(0, BOOKS_SHOWN));
  const moreBooks = $derived(Math.max(0, costs.byBook.length - BOOKS_SHOWN));
  const bookHref = (id: string) =>
    resolve(`/costs?book=${encodeURIComponent(id)}` as "/");
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
      {#if you}
        <p class={cn("text-xl font-semibold tabular-nums", tones[you.tone])}>
          {you.text}
        </p>
      {/if}
      {#if balances === null}
        <p class="text-muted-foreground text-sm text-pretty">
          {m.balances_unavailable()}
        </p>
      {:else if status === "open"}
        <SuggestedPayments
          class="text-sm"
          payments={balances.suggestedPayments}
          currency={balances.currency}
        />
        {#if morePayments > 0}
          <p class="text-muted-foreground text-xs">
            {m.dashboard_costs_more_payments({ count: morePayments })}
          </p>
        {/if}
      {:else if status === "square"}
        <p class="flex items-start gap-2 text-sm text-pretty">
          <CircleCheckIcon
            class="text-success mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          {m.balances_square()}
        </p>
      {/if}
      <div class="flex flex-col gap-1 border-t pt-3 text-sm">
        <p class="flex items-baseline justify-between gap-3">
          <span class="text-muted-foreground"
            >{m.dashboard_costs_year({ year: costs.year })}</span
          >
          <span class="font-medium whitespace-nowrap tabular-nums"
            >{formatMoney(costs.totalMinor, costs.currency)}</span
          >
        </p>
        {#if books.length > 1}
          <ul class="flex flex-col">
            {#each books as book (book.bookId)}
              <li>
                <a
                  href={bookHref(book.bookId)}
                  class="text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-10 items-baseline justify-between gap-3 rounded-md px-2 py-2 text-xs outline-none focus-visible:ring-[3px]"
                >
                  <span class="min-w-0 wrap-anywhere">
                    {book.bookName}
                    {#if book.archived}
                      <span class="opacity-75"
                        >({m.costbook_archived_badge()})</span
                      >
                    {/if}
                  </span>
                  <span class="whitespace-nowrap tabular-nums"
                    >{formatMoney(book.totalMinor, costs.currency)}</span
                  >
                </a>
              </li>
            {/each}
          </ul>
          {#if moreBooks > 0}
            <p class="text-muted-foreground text-xs">
              {m.dashboard_costs_more_books({ count: moreBooks })}
            </p>
          {/if}
        {/if}
      </div>
      {#if canWrite}
        <Button
          href={resolve("/costs/quick")}
          variant="outline"
          size="lg"
          class="self-start"
        >
          <ZapIcon />
          {m.dashboard_costs_quick()}
        </Button>
      {/if}
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
