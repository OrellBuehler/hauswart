<script lang="ts">
  import { resolve } from "$app/paths";
  import type { CostEntry } from "$lib/api/schemas/costs";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import { categoryLabels } from "$lib/costs/labels";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import CostAmount from "./cost-amount.svelte";
  import CostFlags from "./cost-flags.svelte";

  let { cost }: { cost: CostEntry } = $props();

  const meta = $derived(
    [formatDay(cost.date), categoryLabels[cost.category](), cost.payee]
      .filter(Boolean)
      .join(" · "),
  );
  const place = $derived(
    [cost.assetName, cost.roomName].filter(Boolean).join(" · "),
  );
</script>

<li>
  <a
    href={resolve(`/costs/${cost.id}` as "/")}
    class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-2 px-4 py-3.5 transition-colors outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-[3px]"
  >
    <span class="flex items-start gap-3">
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-pretty break-words"
          >{cost.title}</span
        >
        <span class="text-muted-foreground mt-0.5 block text-xs break-words"
          >{meta}</span
        >
        {#if place}
          <span class="text-muted-foreground block text-xs break-words"
            >{place}</span
          >
        {/if}
      </span>
      <span class="shrink-0 text-end">
        <CostAmount
          amountMinor={cost.amountMinor}
          currency={cost.currency}
          class="block text-sm font-medium"
        />
        <span class="text-muted-foreground block max-w-28 truncate text-xs"
          >{cost.paidByName ?? m.cost_payer_open()}</span
        >
      </span>
    </span>
    {#if cost.amountMinor < 0 || !cost.countsAsExpense || cost.source !== "manual" || cost.commentCount > 0}
      <span class="flex flex-wrap items-center justify-between gap-2">
        <CostFlags {cost} />
        <CommentCount count={cost.commentCount} class="ms-auto" />
      </span>
    {/if}
  </a>
</li>
