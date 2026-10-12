<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import InfoIcon from "@lucide/svelte/icons/info";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { CostBalances } from "$lib/api/schemas/costs";
  import {
    balanceState,
    crossBookNote,
    viewerLine,
    type BalanceTone,
  } from "$lib/costs/balances";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import SuggestedPayments from "./suggested-payments.svelte";

  let {
    balances,
    userId,
    href,
    showYou = true,
    class: className,
  }: {
    /** `null` when they could not be read. */
    balances: CostBalances | null;
    /** The person looking: their own line comes first. */
    userId: string;
    /** The Saldo page, with the same book. */
    href: string;
    /** Leaves out the headline with the viewer's own balance (the caller shows it). */
    showYou?: boolean;
    class?: string;
  } = $props();

  const status = $derived(balances ? balanceState(balances) : "empty");
  const you = $derived(balances ? viewerLine(balances, userId) : null);
  const crossBook = $derived(balances ? crossBookNote(balances) : null);
  const tones: Record<BalanceTone, string> = {
    credit: "text-success",
    debit: "text-destructive",
    even: "",
  };
</script>

<div class={cn("flex flex-col gap-3", className)}>
  {#if balances === null}
    <p class="text-muted-foreground flex items-start gap-2 text-pretty">
      <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {m.balances_unavailable()}
    </p>
  {:else}
    {#if you && showYou}
      <p class={cn("text-lg font-semibold tabular-nums", tones[you.tone])}>
        {you.text}
      </p>
    {/if}
    {#if status === "open"}
      <SuggestedPayments
        payments={balances.suggestedPayments}
        currency={balances.currency}
      />
    {:else if status === "square"}
      <p class="flex items-start gap-2 text-pretty">
        <CircleCheckIcon
          class="text-success mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        {m.balances_square()}
      </p>
    {:else}
      <p class="text-muted-foreground flex items-start gap-2 text-pretty">
        <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {m.balances_nothing()}
      </p>
    {/if}
    {#if balances.unassignedPayerCount > 0}
      <p
        class="text-muted-foreground flex items-start gap-2 border-t pt-3 text-xs text-pretty"
      >
        <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span
          >{m.balances_unassigned({
            count: balances.unassignedPayerCount,
          })}</span
        >
      </p>
    {/if}
    {#if crossBook}
      <p
        class="text-muted-foreground flex items-start gap-2 border-t pt-3 text-xs text-pretty"
      >
        <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{crossBook}</span>
      </p>
    {/if}
  {/if}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- the caller resolves the address -->
  <a
    {href}
    class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
  >
    {m.balances_open()}
    <ArrowRightIcon class="size-4" aria-hidden="true" />
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
