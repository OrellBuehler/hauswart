<script lang="ts">
  import PackageCheckIcon from "@lucide/svelte/icons/package-check";
  import PackageMinusIcon from "@lucide/svelte/icons/package-minus";
  import PackageXIcon from "@lucide/svelte/icons/package-x";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import { stockLevel } from "$lib/parts/stock";
  import { cn } from "$lib/utils";

  let {
    part,
    class: className,
  }: {
    part: { stockCount: number; minStock: number };
    class?: string;
  } = $props();

  const level = $derived(stockLevel(part));
  const tones = {
    ok: "border-success/30 bg-success/10 text-success",
    low: "border-warning/40 bg-warning/10 text-warning",
    empty: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  const label = $derived(
    level === "empty"
      ? m.part_stock_empty()
      : level === "low"
        ? m.part_stock_low({ count: part.stockCount })
        : m.part_stock_ok({ count: part.stockCount }),
  );
</script>

<Badge
  variant="outline"
  class={cn("font-medium tabular-nums", tones[level], className)}
  title={m.part_stock_min_title({ min: part.minStock })}
>
  {#if level === "ok"}
    <PackageCheckIcon aria-hidden="true" />
  {:else if level === "low"}
    <PackageMinusIcon aria-hidden="true" />
  {:else}
    <PackageXIcon aria-hidden="true" />
  {/if}
  {label}
</Badge>
