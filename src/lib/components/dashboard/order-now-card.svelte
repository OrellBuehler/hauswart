<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import ShoppingCartIcon from "@lucide/svelte/icons/shopping-cart";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { resolve } from "$app/paths";
  import type { Dashboard } from "$lib/api/schemas/dashboard";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDateShort } from "$lib/format";
  import { m } from "$lib/paraglide/messages";

  let { items, today }: { items: Dashboard["orderNow"]; today: string } =
    $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <ShoppingCartIcon
        class="text-muted-foreground size-4"
        aria-hidden="true"
      />
      {m.dashboard_order_now()}
      <span
        class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        >{items.length}</span
      >
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2">
    <ul class="divide-y">
      {#each items as item (item.id)}
        <li>
          <a
            href={resolve(`/parts/${item.partId}` as "/")}
            class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex flex-col gap-1 rounded-md px-2 py-2.5 outline-none focus-visible:ring-[3px]"
          >
            <span class="flex items-baseline justify-between gap-3 text-sm">
              <span class="min-w-0 font-medium break-words"
                >{item.partName}</span
              >
              <span class="text-muted-foreground shrink-0 tabular-nums"
                >{m.dashboard_order_quantity({ quantity: item.quantity })}</span
              >
            </span>
            <span
              class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            >
              <span class="tabular-nums"
                >{m.dashboard_order_needed_by({
                  date: formatDateShort(item.neededBy, { today }),
                })}</span
              >
              <span class="break-words">{item.taskTitle}</span>
              {#if item.late}
                <span
                  class="text-destructive inline-flex items-center gap-1 font-medium"
                >
                  <TriangleAlertIcon class="size-3.5" aria-hidden="true" />
                  {m.dashboard_order_late()}
                </span>
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
    <a
      href={resolve("/parts")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      {m.dashboard_to_parts()}
      <ArrowRightIcon class="size-4" aria-hidden="true" />
    </a>
  </Card.Content>
</Card.Root>
