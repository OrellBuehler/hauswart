<script lang="ts">
  import { formatMoney } from "#lib/format-money.ts";
  import { cn } from "#lib/utils.ts";

  let {
    amountMinor,
    currency,
    class: className,
  }: { amountMinor: number; currency: string; class?: string } = $props();
</script>

<span
  class={cn(
    "whitespace-nowrap tabular-nums",
    amountMinor < 0 && "text-success",
    className,
  )}>{formatMoney(amountMinor, currency)}</span
>
