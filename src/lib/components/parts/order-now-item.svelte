<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { OrderNowItem } from "$lib/api/schemas/parts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateShort } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { partHref, taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";

  let { item, today }: { item: OrderNowItem; today: string } = $props();

  let pending = $state(false);

  async function undo() {
    try {
      await api.call(endpoints.partsOrdered, {
        params: { id: item.partId },
        body: { qty: 0 },
      });
      toast.success(m.toast_undone());
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  }

  async function ordered() {
    if (pending) return;
    pending = true;
    try {
      await api.call(endpoints.partsOrdered, {
        params: { id: item.partId },
        body: { qty: item.quantity },
      });
      await invalidateAll();
      toast.success(
        m.part_ordered_toast_qty({ name: item.partName, qty: item.quantity }),
        { action: { label: m.common_undo(), onClick: () => void undo() } },
      );
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      pending = false;
    }
  }
</script>

<li class="flex flex-col gap-3 px-4 py-3.5">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <a
        href={partHref(item.partId)}
        class="font-medium break-words underline-offset-4 hover:underline"
      >
        {item.partName}
      </a>
      <p class="text-muted-foreground text-sm">
        {m.order_now_for_task()}
        <a
          href={taskHref(item.taskId)}
          class="underline-offset-4 hover:underline"
        >
          {item.taskTitle}
        </a>
      </p>
    </div>
    <span
      class="shrink-0 text-end text-lg leading-tight font-semibold tabular-nums"
    >
      {m.order_now_qty({ qty: item.quantity })}
    </span>
  </div>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
    <span class="text-muted-foreground">
      {m.order_now_needed_by({
        date: formatDateShort(item.neededBy, { today }),
      })}
    </span>
    {#if item.late}
      <Badge
        variant="outline"
        class="border-destructive/30 bg-destructive/10 text-destructive"
        title={m.order_now_late_hint({
          date: formatDateShort(item.orderBy, { today }),
        })}
      >
        {m.order_now_late()}
      </Badge>
    {/if}
    <span class="text-muted-foreground tabular-nums">
      {m.order_now_stock({ count: item.stockCount })}
    </span>
    {#if item.supplier}
      <span class="text-muted-foreground">{item.supplier}</span>
    {/if}
    {#if item.unitPriceMinor !== null}
      <span class="text-muted-foreground tabular-nums">
        {formatMoney(item.unitPriceMinor * item.quantity, item.currency)}
      </span>
    {/if}
  </div>
  <div class="flex flex-wrap gap-2">
    {#if item.shopUrl}
      <Button
        href={item.shopUrl}
        target="_blank"
        rel="noopener noreferrer"
        variant="outline"
        size="lg"
      >
        <ExternalLinkIcon />{m.order_now_shop()}
      </Button>
    {/if}
    <Button
      size="lg"
      disabled={pending}
      aria-label={m.order_now_ordered_aria({ name: item.partName })}
      onclick={ordered}
    >
      {#if pending}
        <LoaderCircleIcon class="animate-spin" />
      {:else}
        <CheckIcon />
      {/if}
      {m.order_now_ordered()}
    </Button>
  </div>
</li>
