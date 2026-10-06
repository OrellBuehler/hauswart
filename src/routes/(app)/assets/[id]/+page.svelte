<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { kindLabels } from "$lib/assets/kinds";
  import { newTaskHref } from "$lib/assets/links";
  import { warrantyStatus } from "$lib/assets/warranty";
  import AssetKindIcon from "$lib/components/assets/asset-kind-icon.svelte";
  import AssetContactsCard from "$lib/components/assets/asset-contacts-card.svelte";
  import AssetHintsCard from "$lib/components/assets/asset-hints-card.svelte";
  import AssetPartsCard from "$lib/components/assets/asset-parts-card.svelte";
  import AssetServiceLogCard from "$lib/components/assets/asset-service-log-card.svelte";
  import QrCard from "$lib/components/assets/qr-card.svelte";
  import TaskRows from "$lib/components/assets/task-rows.svelte";
  import WarrantyBadge from "$lib/components/assets/warranty-badge.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let deleteOpen = $state(false);
  let archiving = $state(false);

  const asset = $derived(data.asset);
  const isPlant = $derived(asset.kind === "plant");
  const warranty = $derived(warrantyStatus(asset, data.today));
  const backHref = $derived(
    isPlant ? resolve("/plants") : resolve("/inventory"),
  );

  const facts = $derived(
    (
      [
        [m.asset_category(), asset.category],
        [m.asset_manufacturer(), asset.manufacturer],
        [m.asset_model(), asset.model],
        [m.asset_serial(), asset.serialNumber],
        [m.asset_species(), asset.species],
        [m.asset_light(), asset.light],
        [m.asset_water_notes(), asset.waterNotes],
        [
          m.asset_purchase_date(),
          asset.purchaseDate ? formatDay(asset.purchaseDate) : null,
        ],
        [
          m.asset_installed_date(),
          asset.installedDate ? formatDay(asset.installedDate) : null,
        ],
      ] as const
    ).flatMap(([label, value]) => (value ? [[label, value] as const] : [])),
  );

  async function toggleArchive() {
    if (archiving) return;
    archiving = true;
    try {
      const archived = !asset.archivedAt;
      await api.call(endpoints.assetsUpdate, {
        params: { id: asset.id },
        body: { archived },
      });
      toast.success(
        archived
          ? m.asset_archived_toast({ name: asset.name })
          : m.asset_restored_toast({ name: asset.name }),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      archiving = false;
    }
  }

  async function remove() {
    const { id, name } = asset;
    await api.call(endpoints.assetsDelete, { params: { id } });
    toast.success(m.asset_deleted_toast({ name }));
    await goto(backHref);
  }
</script>

<svelte:head>
  <title>{asset.name} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4 print:hidden">
    <Button
      href={backHref}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit"
    >
      <ArrowLeftIcon />{isPlant ? m.nav_plants() : m.nav_inventory()}
    </Button>
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <AssetKindIcon kind={asset.kind} tile class="size-12 rounded-xl" />
        <div class="min-w-0">
          <h1
            class="text-2xl font-semibold tracking-tight text-balance md:text-3xl"
          >
            {asset.name}
          </h1>
          <p
            class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-sm"
          >
            <span>{kindLabels[asset.kind]()}</span>
            {#if asset.roomId && asset.roomName}
              <span aria-hidden="true">·</span>
              <a
                href={resolve(`/rooms/${asset.roomId}`)}
                class="hover:text-foreground underline-offset-4 hover:underline"
              >
                {asset.roomName}
              </a>
            {/if}
            {#if asset.archivedAt}
              <Badge variant="secondary">{m.asset_archived()}</Badge>
            {/if}
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          href={resolve(`/assets/${asset.id}/edit`)}
          variant="outline"
          class="max-sm:hidden"
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
                aria-label={m.asset_actions()}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              class="sm:hidden"
              onclick={() => goto(resolve(`/assets/${asset.id}/edit`))}
            >
              <PencilIcon />{m.common_edit()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={toggleArchive}>
              {#if asset.archivedAt}
                <ArchiveRestoreIcon />{m.asset_restore()}
              {:else}
                <ArchiveIcon />{m.asset_archive()}
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => (deleteOpen = true)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>
  </div>

  <div class="grid items-start gap-6 lg:grid-cols-3 print:block">
    <div class="flex min-w-0 flex-col gap-6 lg:col-span-2 print:hidden">
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.asset_facts_title()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-5">
          <dl
            class="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-3 text-sm sm:gap-x-6"
          >
            {#if !isPlant}
              <dt class="text-muted-foreground">{m.asset_warranty()}</dt>
              <dd class="flex flex-col items-start gap-1">
                <WarrantyBadge info={warranty} />
                {#if asset.warrantyUntil && asset.warrantyExtendedUntil}
                  <span class="text-muted-foreground text-xs">
                    {m.asset_warranty_detail({
                      until: formatDay(asset.warrantyUntil),
                      extended: formatDay(asset.warrantyExtendedUntil),
                    })}
                  </span>
                {/if}
              </dd>
            {/if}
            {#each facts as [label, value] (label)}
              <dt class="text-muted-foreground">{label}</dt>
              <dd class="font-medium break-words whitespace-pre-line">
                {value}
              </dd>
            {/each}
            <dt class="text-muted-foreground">{m.asset_emergency_short()}</dt>
            <dd class="font-medium">
              {asset.showOnEmergency ? m.common_yes() : m.common_no()}
            </dd>
          </dl>
          {#if asset.notes}
            <div class="border-t pt-4">
              <h3 class="text-muted-foreground mb-1.5 text-sm">
                {m.asset_notes()}
              </h3>
              <p class="text-sm whitespace-pre-line">{asset.notes}</p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{m.asset_tasks_title()}</Card.Title>
          <Card.Action>
            <Button href={newTaskHref(asset.id)} size="sm" variant="outline">
              <PlusIcon />{m.asset_add_task()}
            </Button>
          </Card.Action>
        </Card.Header>
        <Card.Content>
          {#if data.tasks.length === 0}
            <EmptyState
              icon={ListChecksIcon}
              title={m.asset_tasks_empty_title()}
              description={m.asset_tasks_empty_body()}
              class="py-8"
            >
              {#snippet actions()}
                <Button href={newTaskHref(asset.id)}>
                  <PlusIcon />{m.asset_add_task()}
                </Button>
              {/snippet}
            </EmptyState>
          {:else}
            <TaskRows tasks={data.tasks} />
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{m.asset_docs_title()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <EmptyState
            icon={FileTextIcon}
            title={m.coming_soon_badge()}
            description={m.asset_docs_soon()}
            class="py-8"
          />
        </Card.Content>
      </Card.Root>

      <AssetHintsCard assetId={asset.id} hints={data.hints} />
      <AssetContactsCard assetId={asset.id} links={data.contacts} />
      <AssetPartsCard
        assetId={asset.id}
        parts={data.parts}
        currency={data.currency}
      />
      <AssetServiceLogCard
        assetId={asset.id}
        entries={data.serviceLog.items}
        nextCursor={data.serviceLog.nextCursor}
        today={data.today}
        currency={data.currency}
      />
    </div>

    <div class="lg:sticky lg:top-16">
      <QrCard {asset} origin={page.url.origin} />
    </div>
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.asset_delete_title()}
  description={m.asset_delete_description({ name: asset.name })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
