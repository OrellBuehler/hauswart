<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { personName, type SuggestedPayment } from "$lib/costs/balances";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    payments,
    currency,
    onrecord,
    disabled = false,
    class: className,
  }: {
    payments: SuggestedPayment[];
    currency: string;
    /** Offers "Als bezahlt erfassen" next to each payment. */
    onrecord?: ((payment: SuggestedPayment) => void) | undefined;
    disabled?: boolean;
    class?: string;
  } = $props();
</script>

<ul class={cn("flex flex-col gap-3", className)}>
  {#each payments as payment (`${payment.fromUserId}:${payment.toUserId}`)}
    {@const from = personName(payment.fromName)}
    {@const to = personName(payment.toName)}
    <li
      class={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-2",
        onrecord && "sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center",
      )}
    >
      <span class="min-w-0 wrap-anywhere"
        >{m.costs_settlement_who({ from, to })}</span
      >
      <span class="shrink-0 font-semibold whitespace-nowrap tabular-nums"
        >{formatMoney(payment.amountMinor, currency)}</span
      >
      {#if onrecord}
        <Button
          variant="outline"
          class="col-span-2 sm:col-span-1"
          {disabled}
          aria-label={m.balances_record_for({ from, to })}
          onclick={() => onrecord(payment)}
        >
          {m.balances_record()}
        </Button>
      {/if}
    </li>
  {/each}
</ul>
