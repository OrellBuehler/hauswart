<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { resolve } from "$app/paths";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import TruckIcon from "@lucide/svelte/icons/truck";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { PartMovementReason } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { PartMovement } from "$lib/api/schemas/parts";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import AssetPartDialog from "$lib/components/parts/asset-part-dialog.svelte";
  import OrderedBadge from "$lib/components/parts/ordered-badge.svelte";
  import OrderedDialog from "$lib/components/parts/ordered-dialog.svelte";
  import PartFormDialog from "$lib/components/parts/part-form-dialog.svelte";
  import StockBadge from "$lib/components/parts/stock-badge.svelte";
  import StockDialog from "$lib/components/parts/stock-dialog.svelte";
  import TaskPartDialog from "$lib/components/parts/task-part-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateTime } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { assetHref, taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { movementReasonLabels } from "$lib/parts/labels";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let editOpen = $state(false);
  let deleteOpen = $state(false);
  let stockOpen = $state(false);
  let stockReason = $state<PartMovementReason>("used");
  let stockQty = $state(1);
  let orderedOpen = $state(false);
  let assetLinkOpen = $state(false);
  let taskLinkOpen = $state(false);
  let taskQty = $state<
    { taskId: string; partId: string; label: string; qty: number } | undefined
  >();
  let taskQtyOpen = $state(false);
  let busy = $state<string | null>(null);

  const part = $derived(data.part);
  const archived = $derived(part.archivedAt !== null);

  let more = $state.raw<{
    base: PartMovement[];
    items: PartMovement[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  const loaded = $derived(
    more && more.base === data.movements.items ? more : null,
  );
  const movements = $derived([
    ...data.movements.items,
    ...(loaded?.items ?? []),
  ]);
  const cursor = $derived(loaded ? loaded.cursor : data.movements.nextCursor);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.partsMovements, {
        params: { id: part.id },
        query: { limit: 20, cursor },
      });
      more = {
        base: data.movements.items,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  function openStock(reason: PartMovementReason, qty = 1) {
    stockReason = reason;
    stockQty = qty;
    stockOpen = true;
  }

  async function quick(reason: "used" | "bought") {
    if (busy) return;
    busy = reason;
    try {
      await api.call(endpoints.partsStock, {
        params: { id: part.id },
        body: { delta: reason === "used" ? -1 : 1, reason },
      });
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function clearOrder() {
    if (busy) return;
    busy = "order";
    try {
      await api.call(endpoints.partsOrdered, {
        params: { id: part.id },
        body: { qty: 0 },
      });
      toast.success(m.part_order_cleared_toast());
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function toggleArchive() {
    if (busy) return;
    busy = "archive";
    try {
      await api.call(endpoints.partsUpdate, {
        params: { id: part.id },
        body: { archived: !archived },
      });
      toast.success(
        archived
          ? m.part_restored_toast({ name: part.name })
          : m.part_archived_toast({ name: part.name }),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function remove() {
    const { id, name } = part;
    await api.call(endpoints.partsDelete, { params: { id } });
    toast.success(m.part_deleted_toast({ name }));
    await gotoFromOverlay(resolve("/parts"), { invalidateAll: true });
  }

  async function unlinkAsset(assetId: string, name: string) {
    if (busy) return;
    busy = assetId;
    try {
      await api.call(endpoints.assetPartsUnlink, {
        params: { id: assetId, partId: part.id },
      });
      toast.success(m.part_unlinked_toast({ name }));
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function unlinkTask(taskId: string, title: string) {
    if (busy) return;
    busy = taskId;
    try {
      await api.call(endpoints.taskPartsUnlink, {
        params: { id: taskId, partId: part.id },
      });
      toast.success(m.part_unlinked_toast({ name: title }));
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  function editQty(task: { id: string; title: string; qty: number }) {
    taskQty = {
      taskId: task.id,
      partId: part.id,
      label: task.title,
      qty: task.qty,
    };
    taskQtyOpen = true;
  }

  function movementText(movement: PartMovement): string {
    return movement.completionId
      ? m.part_movement_by_task()
      : (movement.userName ?? m.completion_unknown_user());
  }
</script>

<svelte:head>
  <title>{part.name} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/parts")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{m.nav_parts()}
    </Button>
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          <PuzzleIcon class="size-6" />
        </span>
        <div class="min-w-0">
          <h1
            class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
          >
            {part.name}
          </h1>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StockBadge {part} />
            <OrderedBadge {part} />
            {#if archived}
              <Badge variant="secondary">{m.part_archived()}</Badge>
            {/if}
          </div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          class="max-sm:hidden"
          onclick={() => (editOpen = true)}
        >
          <PencilIcon />{m.common_edit()}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon"
                aria-label={m.part_actions()}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              class="min-h-10 sm:hidden"
              onSelect={() => (editOpen = true)}
            >
              <PencilIcon />{m.common_edit()}
            </DropdownMenu.Item>
            <DropdownMenu.Item class="min-h-10" onSelect={toggleArchive}>
              {#if archived}
                <ArchiveRestoreIcon />{m.part_restore()}
              {:else}
                <ArchiveIcon />{m.part_archive()}
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              class="min-h-10"
              onSelect={() => (deleteOpen = true)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>
  </div>

  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
    <div class="flex min-w-0 flex-col gap-6 max-lg:contents lg:col-span-2">
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.part_stock_title()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-5">
          <div class="flex items-end justify-between gap-4">
            <p class="text-5xl leading-none font-semibold tabular-nums">
              {part.stockCount}
            </p>
            <dl
              class="text-muted-foreground grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs"
            >
              <dt>{m.part_min_stock()}</dt>
              <dd class="text-foreground text-end tabular-nums">
                {part.minStock}
              </dd>
              <dt>{m.part_reorder_qty()}</dt>
              <dd class="text-foreground text-end tabular-nums">
                {part.reorderQty}
              </dd>
              <dt>{m.part_lead_time()}</dt>
              <dd class="text-foreground text-end tabular-nums">
                {part.leadTimeDays}
              </dd>
            </dl>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              disabled={busy !== null || part.stockCount < 1}
              onclick={() => quick("used")}
            >
              {#if busy === "used"}
                <LoaderCircleIcon class="animate-spin" />
              {:else}
                <MinusIcon />
              {/if}
              {m.part_quick_used()}
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={busy !== null}
              onclick={() => quick("bought")}
            >
              {#if busy === "bought"}
                <LoaderCircleIcon class="animate-spin" />
              {:else}
                <PlusIcon />
              {/if}
              {m.part_quick_bought()}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="lg"
            class="w-full"
            onclick={() => openStock("used")}
          >
            {m.part_stock_adjust()}
          </Button>
          <div
            class={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm",
              part.orderedAt && "bg-secondary/50",
            )}
          >
            {#if part.orderedAt}
              <p class="flex items-center gap-2">
                <TruckIcon class="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {m.part_on_order_since({
                    qty: part.orderedQty,
                    date: formatDateTime(part.orderedAt),
                  })}
                </span>
              </p>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy !== null}
                  onclick={() => openStock("bought", part.orderedQty)}
                >
                  {m.part_order_arrived()}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={busy !== null}
                  onclick={clearOrder}
                >
                  {m.part_order_clear()}
                </Button>
              </div>
            {:else}
              <p class="text-muted-foreground">{m.part_not_ordered()}</p>
              <Button
                variant="outline"
                size="lg"
                onclick={() => (orderedOpen = true)}
              >
                <TruckIcon />{m.part_mark_ordered()}
              </Button>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root class="max-lg:order-last">
        <Card.Header>
          <Card.Title>{m.part_movements_title()}</Card.Title>
        </Card.Header>
        <Card.Content>
          {#if movements.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.part_movements_empty()}
            </p>
          {:else}
            <ul class="divide-y">
              {#each movements as movement (movement.id)}
                <li class="flex items-start gap-3 py-3">
                  <span
                    class={cn(
                      "w-12 shrink-0 text-end text-base font-semibold tabular-nums",
                      movement.delta > 0 ? "text-success" : "text-foreground",
                    )}
                  >
                    {movement.delta > 0 ? "+" : "−"}{Math.abs(movement.delta)}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">
                      {movementReasonLabels[movement.reason]()}
                    </p>
                    <p class="text-muted-foreground text-xs">
                      {movementText(movement)} · {formatDateTime(movement.at)}
                    </p>
                    {#if movement.note}
                      <p class="mt-0.5 text-sm wrap-anywhere">
                        {movement.note}
                      </p>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
            {#if cursor}
              <div class="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={loadingMore}
                  onclick={loadMore}
                >
                  {#if loadingMore}
                    <LoaderCircleIcon class="animate-spin" />
                  {/if}
                  {m.common_load_more()}
                </Button>
              </div>
            {/if}
          {/if}
        </Card.Content>
      </Card.Root>
    </div>

    <div class="flex flex-col gap-6 max-lg:contents">
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.part_facts_title()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <dl
            class="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm"
          >
            <dt class="text-muted-foreground">{m.part_number()}</dt>
            <dd class="font-medium wrap-anywhere">{part.partNumber ?? "–"}</dd>
            <dt class="text-muted-foreground">{m.part_supplier()}</dt>
            <dd class="font-medium wrap-anywhere">{part.supplier ?? "–"}</dd>
            <dt class="text-muted-foreground">{m.part_unit_price()}</dt>
            <dd class="font-medium tabular-nums">
              {part.unitPriceMinor === null
                ? "–"
                : formatMoney(part.unitPriceMinor, part.currency)}
            </dd>
          </dl>
          {#if part.shopUrl}
            <Button
              href={part.shopUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="lg"
            >
              <ExternalLinkIcon />{m.order_now_shop()}
            </Button>
          {/if}
          {#if part.notes}
            <div class="border-t pt-4">
              <h3 class="text-muted-foreground mb-1.5 text-sm">
                {m.part_notes()}
              </h3>
              <p class="text-sm wrap-anywhere whitespace-pre-line">
                {part.notes}
              </p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{m.part_assets_title()}</Card.Title>
          <Card.Action>
            <Button
              size="sm"
              variant="outline"
              onclick={() => (assetLinkOpen = true)}
            >
              <PlusIcon />{m.part_link_add()}
            </Button>
          </Card.Action>
        </Card.Header>
        <Card.Content>
          {#if part.assets.length === 0}
            <EmptyState
              icon={BoxesIcon}
              title={m.part_assets_empty_title()}
              description={m.part_assets_empty_body()}
              class="py-8"
            />
          {:else}
            <ul class="divide-y">
              {#each part.assets as asset (asset.id)}
                <li class="flex items-center justify-between gap-2">
                  <a
                    href={assetHref(asset.id)}
                    class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-12 min-w-0 flex-1 items-center rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]"
                  >
                    <span class="truncate">{asset.name}</span>
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy !== null}
                    aria-label={m.part_unlink_aria({ name: asset.name })}
                    onclick={() => unlinkAsset(asset.id, asset.name)}
                  >
                    <UnlinkIcon />
                  </Button>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{m.part_tasks_title()}</Card.Title>
          <Card.Action>
            <Button
              size="sm"
              variant="outline"
              onclick={() => (taskLinkOpen = true)}
            >
              <PlusIcon />{m.part_link_add()}
            </Button>
          </Card.Action>
        </Card.Header>
        <Card.Content>
          {#if part.tasks.length === 0}
            <EmptyState
              icon={ListChecksIcon}
              title={m.part_tasks_empty_title()}
              description={m.part_tasks_empty_body()}
              class="py-8"
            />
          {:else}
            <ul class="divide-y">
              {#each part.tasks as task (task.id)}
                <li class="flex items-center justify-between gap-2">
                  <a
                    href={taskHref(task.id)}
                    class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-12 min-w-0 flex-1 items-center rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]"
                  >
                    <span class="truncate">{task.title}</span>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="tabular-nums"
                    aria-label={m.task_part_edit_aria({ title: task.title })}
                    onclick={() => editQty(task)}
                  >
                    {m.task_part_qty_each({ qty: task.qty })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy !== null}
                    aria-label={m.part_unlink_aria({ name: task.title })}
                    onclick={() => unlinkTask(task.id, task.title)}
                  >
                    <UnlinkIcon />
                  </Button>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <Attachments
        ownerType="part"
        ownerId={part.id}
        title={m.part_files_title()}
      />

      <LinkedDocuments ownerType="part" ownerId={part.id} />
    </div>
  </div>
</div>

<PartFormDialog
  bind:open={editOpen}
  {part}
  currency={data.currency}
  onsaved={() => invalidateAll()}
/>
<StockDialog
  bind:open={stockOpen}
  {part}
  initialReason={stockReason}
  initialQty={stockQty}
  onsaved={() => invalidateAll()}
/>
<OrderedDialog bind:open={orderedOpen} {part} onsaved={() => invalidateAll()} />
<AssetPartDialog
  bind:open={assetLinkOpen}
  partId={part.id}
  excludeIds={part.assets.map((a) => a.id)}
  onlinked={() => invalidateAll()}
/>
<TaskPartDialog
  bind:open={taskLinkOpen}
  partId={part.id}
  excludeIds={part.tasks.map((t) => t.id)}
  onsaved={() => invalidateAll()}
/>
<TaskPartDialog
  bind:open={taskQtyOpen}
  existing={taskQty}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.part_delete_title()}
  description={m.part_delete_description({ name: part.name })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
