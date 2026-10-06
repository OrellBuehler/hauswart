<script lang="ts">
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import type { Snippet } from "svelte";
  import type { Part } from "$lib/api/schemas/parts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { formatMoney } from "$lib/format-money";
  import { partHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import OrderedBadge from "./ordered-badge.svelte";
  import StockBadge from "./stock-badge.svelte";

  let {
    part,
    trailing,
  }: {
    part: Part;
    trailing?: Snippet;
  } = $props();

  const subtitle = $derived(
    [part.partNumber, part.supplier].filter(Boolean).join(" · "),
  );
</script>

<li class="relative flex items-start gap-3 px-4 py-3.5">
  <span
    class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
    aria-hidden="true"
  >
    <PuzzleIcon class="size-5" />
  </span>
  <div class="min-w-0 flex-1">
    <a
      href={partHref(part.id)}
      class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm font-medium break-words underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-[3px]"
    >
      {part.name}
    </a>
    {#if subtitle}
      <p class="text-muted-foreground truncate text-sm">{subtitle}</p>
    {/if}
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      <StockBadge {part} />
      <OrderedBadge {part} />
      {#if part.archivedAt}
        <Badge variant="secondary">{m.part_archived()}</Badge>
      {/if}
      {#if part.unitPriceMinor !== null}
        <span class="text-muted-foreground ms-auto text-sm tabular-nums">
          {formatMoney(part.unitPriceMinor, part.currency)}
        </span>
      {/if}
    </div>
  </div>
  {#if trailing}
    <div class="relative z-10 shrink-0">{@render trailing()}</div>
  {/if}
</li>
