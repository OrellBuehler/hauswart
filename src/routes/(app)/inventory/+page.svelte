<script lang="ts">
  import { resolve } from "$app/paths";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import QrCodeIcon from "@lucide/svelte/icons/qr-code";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import { INVENTORY_KINDS, kindLabels } from "$lib/assets/kinds";
  import {
    emptyFilter,
    filterAssets,
    isFiltered,
    type AssetFilter,
  } from "$lib/assets/filter";
  import { newAssetHref } from "$lib/assets/links";
  import { WARRANTY_STATUSES, warrantyStatus } from "$lib/assets/warranty";
  import AssetKindIcon from "$lib/components/assets/asset-kind-icon.svelte";
  import AssetRow from "$lib/components/assets/asset-row.svelte";
  import OptionSelect from "$lib/components/assets/option-select.svelte";
  import RoomPicker from "$lib/components/assets/room-picker.svelte";
  import WarrantyBadge from "$lib/components/assets/warranty-badge.svelte";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let filter = $state<AssetFilter>({ ...emptyFilter });

  const warrantyLabels = {
    valid: () => m.warranty_filter_valid(),
    expiring: () => m.warranty_filter_expiring(),
    expired: () => m.warranty_filter_expired(),
    unknown: () => m.warranty_filter_unknown(),
  };
  const kindOptions = INVENTORY_KINDS.map((kind) => ({
    value: kind,
    label: kindLabels[kind](),
  }));
  const warrantyOptions = WARRANTY_STATUSES.map((status) => ({
    value: status,
    label: warrantyLabels[status](),
  }));

  const visible = $derived(
    filterAssets(data.assets, filter, data.today).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  );
  const filtered = $derived(isFiltered(filter));
  const hasArchived = $derived(data.assets.some((a) => a.archivedAt));
  const total = $derived(data.assets.filter((a) => !a.archivedAt).length);

  function reset() {
    filter = { ...emptyFilter };
  }

  function details(asset: (typeof data.assets)[number]): string {
    return [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  }
</script>

<svelte:head>
  <title>{m.nav_inventory()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_inventory()} description={m.inventory_description()}>
    {#snippet actions()}
      <Button href={resolve("/inventory/qr")} variant="outline">
        <QrCodeIcon />{m.inventory_qr_sheet()}
      </Button>
      <Button href={newAssetHref("device")}>
        <PlusIcon />{m.inventory_create()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if data.assets.length === 0}
    <EmptyState
      icon={BoxesIcon}
      title={m.inventory_empty_title()}
      description={m.inventory_empty_body()}
    >
      {#snippet actions()}
        <Button href={newAssetHref("device")}>
          <PlusIcon />{m.inventory_create()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <section class="flex flex-col gap-3" aria-label={m.inventory_filters()}>
      <div class="relative">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          class="ps-9"
          placeholder={m.inventory_search_placeholder()}
          aria-label={m.inventory_search()}
          autocomplete="off"
          bind:value={filter.q}
        />
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <RoomPicker
          rooms={data.rooms}
          bind:value={filter.roomId}
          noneLabel={m.inventory_filter_all_rooms()}
          class="max-md:col-span-2"
        />
        <OptionSelect
          options={kindOptions}
          bind:value={filter.kind}
          noneLabel={m.inventory_filter_all_kinds()}
        />
        <OptionSelect
          options={warrantyOptions}
          bind:value={filter.warranty}
          noneLabel={m.inventory_filter_all_warranties()}
        />
        {#if hasArchived}
          <div class="flex h-9 items-center gap-2 max-md:col-span-2">
            <Switch id="inventory-archived" bind:checked={filter.archived} />
            <Label for="inventory-archived" class="font-normal">
              {m.inventory_show_archived()}
            </Label>
          </div>
        {/if}
      </div>
      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <p aria-live="polite">
          {filtered
            ? m.inventory_result_count({ shown: visible.length, total })
            : m.inventory_count({ count: total })}
        </p>
        {#if filtered}
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            onclick={reset}
          >
            {m.inventory_filter_reset()}
          </Button>
        {/if}
      </div>
    </section>

    {#if visible.length === 0}
      <EmptyState
        icon={SearchXIcon}
        title={m.inventory_no_results_title()}
        description={m.inventory_no_results_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}>
            {m.inventory_filter_reset()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border md:hidden">
        {#each visible as asset (asset.id)}
          <AssetRow {asset} today={data.today} showRoom />
        {/each}
      </ul>

      <div class="rounded-lg border max-md:hidden">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.asset_name()}</Table.Head>
              <Table.Head>{m.asset_room()}</Table.Head>
              <Table.Head>{m.inventory_col_model()}</Table.Head>
              <Table.Head>{m.asset_purchase_date()}</Table.Head>
              <Table.Head>{m.asset_warranty()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each visible as asset (asset.id)}
              <Table.Row class="relative">
                <Table.Cell class="font-medium">
                  <a
                    href={resolve(`/assets/${asset.id}`)}
                    class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 flex items-center gap-2.5 rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                  >
                    <AssetKindIcon
                      kind={asset.kind}
                      class="text-muted-foreground"
                    />
                    <span class="truncate">{asset.name}</span>
                    <CommentCount count={asset.commentCount} class="shrink-0" />
                    {#if asset.archivedAt}
                      <Badge variant="secondary">{m.asset_archived()}</Badge>
                    {/if}
                  </a>
                </Table.Cell>
                <Table.Cell class="text-muted-foreground">
                  {asset.roomName ?? "–"}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground">
                  {details(asset) || "–"}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground tabular-nums">
                  {asset.purchaseDate ? formatDay(asset.purchaseDate) : "–"}
                </Table.Cell>
                <Table.Cell>
                  <WarrantyBadge info={warrantyStatus(asset, data.today)} />
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  {/if}
</div>
