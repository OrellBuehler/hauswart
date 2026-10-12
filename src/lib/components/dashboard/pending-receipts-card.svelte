<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import ReceiptTextIcon from "@lucide/svelte/icons/receipt-text";
  import { resolve } from "$app/paths";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";

  let { count }: { count: number } = $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <ReceiptTextIcon class="text-warning size-4" aria-hidden="true" />
      {m.dashboard_receipts_title()}
      <span
        class="bg-warning/15 text-warning rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        >{count}</span
      >
    </Card.Title>
    <Card.Description>{m.dashboard_receipts_description()}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2">
    <p class="text-sm">{m.costs_receipts_pending({ count })}</p>
    <a
      href={resolve("/costs/receipts?status=pending" as "/")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      {m.dashboard_to_receipts()}
      <ArrowRightIcon class="size-4" aria-hidden="true" />
    </a>
  </Card.Content>
</Card.Root>
