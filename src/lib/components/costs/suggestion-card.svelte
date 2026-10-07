<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import type { FinanceSuggestion } from "$lib/api/schemas/finance";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    categoryLabels,
    suggestionKindIcons,
    suggestionKindLabels,
  } from "$lib/costs/labels";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import CostAmount from "./cost-amount.svelte";

  let {
    suggestion,
    busy = null,
    locked = false,
    onaccept,
    onadjust,
    ondismiss,
  }: {
    suggestion: FinanceSuggestion;
    /** What is running for this suggestion right now. */
    busy?: "accept" | "dismiss" | null;
    /** Another suggestion is being handled: keep the buttons still. */
    locked?: boolean;
    onaccept: () => void;
    onadjust: () => void;
    ondismiss: () => void;
  } = $props();

  const Icon = $derived(suggestionKindIcons[suggestion.kind]);
  const facts = $derived.by(() => {
    switch (suggestion.kind) {
      case "cost":
        return {
          title: suggestion.payload.title,
          meta: [
            formatDay(suggestion.payload.date),
            categoryLabels[suggestion.payload.category](),
            suggestion.payload.payee,
          ]
            .filter(Boolean)
            .join(" · "),
          amountMinor: suggestion.payload.amountMinor as number | null,
          currency: suggestion.payload.currency,
          url: suggestion.payload.url,
          accept: m.finance_accept_cost(),
        };
      case "asset":
        return {
          title: suggestion.payload.name,
          meta: m.finance_asset_meta({
            date: formatDay(suggestion.payload.purchaseDate),
          }),
          amountMinor: suggestion.payload.priceMinor as number | null,
          currency: suggestion.payload.currency,
          url: suggestion.payload.url,
          accept: m.finance_accept_asset(),
        };
      case "bill_task":
        return {
          title: suggestion.payload.title,
          meta: m.finance_bill_meta({
            date: formatDay(suggestion.payload.dueDate),
          }),
          amountMinor: suggestion.payload.amountMinor,
          currency: suggestion.payload.currency,
          url: suggestion.payload.url,
          accept: m.finance_accept_bill_task(),
        };
    }
  });
  const url = $derived(
    facts.url && /^https?:\/\//i.test(facts.url) ? facts.url : null,
  );
  const disabled = $derived(locked || busy !== null);
</script>

<li class="flex flex-col gap-3 px-4 py-4">
  <div class="flex items-start gap-3">
    <span
      class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Icon class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-pretty break-words">{facts.title}</p>
      <p class="text-muted-foreground mt-0.5 text-xs break-words">
        <span class="sr-only"
          >{suggestionKindLabels[suggestion.kind]()}:
        </span>{facts.meta}
      </p>
      {#if suggestion.kind === "cost" && suggestion.payload.assetId}
        <p class="text-muted-foreground mt-0.5 text-xs">
          {m.finance_asset_linked()}
        </p>
      {/if}
    </div>
    {#if facts.amountMinor !== null}
      <CostAmount
        amountMinor={facts.amountMinor}
        currency={facts.currency}
        class="shrink-0 text-sm font-medium"
      />
    {/if}
  </div>
  <div class="flex flex-wrap items-center gap-2 sm:ps-13">
    <Button size="lg" {disabled} onclick={onaccept}>
      {#if busy === "accept"}
        <LoaderCircleIcon class="animate-spin" />{m.finance_accepting()}
      {:else}
        {facts.accept}
      {/if}
    </Button>
    <Button variant="outline" size="lg" {disabled} onclick={onadjust}>
      {m.finance_adjust()}
    </Button>
    <Button variant="ghost" size="lg" {disabled} onclick={ondismiss}>
      {#if busy === "dismiss"}
        <LoaderCircleIcon class="animate-spin" />{m.finance_dismissing()}
      {:else}
        {m.finance_dismiss()}
      {/if}
    </Button>
    {#if url}
      <Button
        variant="ghost"
        size="icon-lg"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={m.finance_open_in_app()}
        title={m.finance_open_in_app()}
      >
        <ExternalLinkIcon />
      </Button>
    {/if}
  </div>
</li>
