<script lang="ts">
  import {
    afterNavigate,
    goto,
    invalidateAll,
    replaceState,
  } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CalendarCheckIcon from "@lucide/svelte/icons/calendar-check";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import FileCheckIcon from "@lucide/svelte/icons/file-check";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import { kindLabels } from "$lib/assets/kinds";
  import { newTaskHref } from "$lib/assets/links";
  import { warrantyStatus } from "$lib/assets/warranty";
  import AssetNotesCard from "$lib/components/asset-notes/asset-notes-card.svelte";
  import AssetPhoto from "$lib/components/assets/asset-photo.svelte";
  import AssetContactsCard from "$lib/components/assets/asset-contacts-card.svelte";
  import AssetHintsCard from "$lib/components/assets/asset-hints-card.svelte";
  import AssetPartsCard from "$lib/components/assets/asset-parts-card.svelte";
  import AssetServiceLogCard from "$lib/components/assets/asset-service-log-card.svelte";
  import QrCard from "$lib/components/assets/qr-card.svelte";
  import FuelLogCard from "$lib/components/vehicles/fuel-log-card.svelte";
  import OdometerHistoryCard from "$lib/components/vehicles/odometer-history-card.svelte";
  import PlateBadge from "$lib/components/vehicles/plate-badge.svelte";
  import TireSetsCard from "$lib/components/vehicles/tire-sets-card.svelte";
  import VehicleCard from "$lib/components/vehicles/vehicle-card.svelte";
  import VehicleCostsCard from "$lib/components/vehicles/vehicle-costs-card.svelte";
  import VehicleSetupDialog from "$lib/components/vehicles/vehicle-setup-dialog.svelte";
  import TaskRows from "$lib/components/assets/task-rows.svelte";
  import WarrantyBadge from "$lib/components/assets/warranty-badge.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import LinkedDocsCard from "$lib/components/docs/linked-docs-card.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import HintCallout from "$lib/components/hints/hint-callout.svelte";
  import AssetInsuranceCard from "$lib/components/insurance/asset-insurance-card.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { docsFilterHref, newDocHref } from "$lib/docs/links";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { statsYears } from "$lib/vehicles/cost-card";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let deleteOpen = $state(false);
  let archiving = $state(false);

  const asset = $derived(data.asset);
  const canWriteDocs = $derived(data.scopes.includes("docs:write"));
  const canWrite = $derived(data.scopes.includes("write"));
  const canWriteCosts = $derived(data.scopes.includes("costs:write"));
  const isPlant = $derived(asset.kind === "plant");
  const isVehicle = $derived(asset.kind === "vehicle");
  let setupOpen = $state(false);

  /** A new vehicle comes here with `?termine=1`: the dialog for its recurring tasks opens once, the address is cleaned first. */
  afterNavigate(() => {
    if (!isVehicle || !canWrite) return;
    if (page.url.searchParams.get("termine") !== "1") return;
    replaceState(resolve(`/assets/${asset.id}` as "/"), page.state);
    setupOpen = true;
  });
  const pinnedHints = $derived(data.hints.filter((hint) => hint.pinned));
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

  async function setPhoto(attachment: Attachment | null) {
    await api.call(endpoints.assetsUpdate, {
      params: { id: asset.id },
      body: { photoAttachmentId: attachment?.id ?? null },
    });
    await invalidateAll();
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
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{isPlant ? m.nav_plants() : m.nav_inventory()}
    </Button>
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <AssetPhoto
          kind={asset.kind}
          photoUrl={asset.photoUrl}
          class="size-12 rounded-xl sm:size-14"
        />
        <div class="min-w-0">
          <h1
            class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
          >
            {asset.name}
          </h1>
          <p
            class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-sm"
          >
            <span>{kindLabels[asset.kind]()}</span>
            {#if isVehicle && asset.vehicle?.plate}
              <PlateBadge plate={asset.vehicle.plate} />
            {/if}
            {#if asset.roomId && asset.roomName}
              <span aria-hidden="true">·</span>
              <a
                href={resolve(`/rooms/${asset.roomId}`)}
                class="hover:text-foreground min-w-0 wrap-anywhere underline-offset-4 hover:underline"
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

  {#if pinnedHints.length > 0}
    <section
      class="flex flex-col gap-3 print:hidden"
      aria-labelledby="asset-pinned-hints"
    >
      <h2 id="asset-pinned-hints" class="text-sm font-semibold">
        {m.qr_hints_title()}
      </h2>
      <ul class="flex flex-col gap-3">
        {#each pinnedHints as hint (hint.id)}
          <HintCallout {hint} prominent />
        {/each}
      </ul>
    </section>
  {/if}

  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 print:block">
    <div class="flex min-w-0 flex-col gap-6 lg:col-span-2 print:hidden">
      {#if data.vehicle}
        <VehicleCard
          assetId={asset.id}
          vehicle={data.vehicle.details}
          today={data.today}
          {canWrite}
        />

        <OdometerHistoryCard
          assetId={asset.id}
          unit={data.vehicle.details.odometerUnit}
          readings={data.vehicle.readings.items}
          nextCursor={data.vehicle.readings.nextCursor}
          {canWrite}
        />

        <TireSetsCard
          assetId={asset.id}
          sets={data.vehicle.tireSets}
          vehicle={data.vehicle.details}
          today={data.today}
          {canWrite}
        />

        <FuelLogCard
          assetId={asset.id}
          logs={data.vehicle.fuelLogs.items}
          nextCursor={data.vehicle.fuelLogs.nextCursor}
          stats={data.vehicle.stats}
          vehicle={data.vehicle.details}
          currency={data.currency}
          today={data.today}
          people={data.vehicle.people}
          currentUserId={data.user.id}
          canWrite={canWriteCosts}
        />

        <VehicleCostsCard
          assetId={asset.id}
          year={data.vehicle.year}
          stats={data.vehicle.yearStats}
          years={statsYears(data.today, [
            data.vehicle.stats.from,
            data.vehicle.details.firstRegistration,
            asset.purchaseDate,
          ])}
          canAddCost={canWriteCosts}
        />
      {/if}

      <Card.Root>
        <Card.Header>
          <Card.Title>{m.asset_facts_title()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-5">
          <dl
            class="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:gap-x-6"
          >
            {#if !isPlant}
              <dt class="text-muted-foreground">{m.asset_warranty()}</dt>
              <dd class="flex flex-col items-start gap-1">
                <WarrantyBadge info={warranty} />
                {#if asset.warrantySource === "document" && (asset.warrantyUntil || asset.warrantyExtendedUntil)}
                  <span
                    class="text-muted-foreground flex items-center gap-1.5 text-xs"
                  >
                    <FileCheckIcon class="size-3.5" aria-hidden="true" />
                    {m.asset_warranty_from_document()}
                  </span>
                {/if}
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
              <dd class="font-medium wrap-anywhere whitespace-pre-line">
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
              <p class="text-sm wrap-anywhere whitespace-pre-line">
                {asset.notes}
              </p>
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
                {#if isVehicle && canWrite}
                  <Button variant="outline" onclick={() => (setupOpen = true)}>
                    <CalendarCheckIcon />{m.vehicle_setup_open()}
                  </Button>
                {/if}
              {/snippet}
            </EmptyState>
          {:else}
            <TaskRows tasks={data.tasks} />
            {#if isVehicle && canWrite}
              <div class="mt-3">
                <Button variant="outline" onclick={() => (setupOpen = true)}>
                  <CalendarCheckIcon />{m.vehicle_setup_open()}
                </Button>
              </div>
            {/if}
          {/if}
        </Card.Content>
      </Card.Root>

      <AssetNotesCard
        assetId={asset.id}
        assetName={asset.name}
        notes={data.notes}
        {canWrite}
      />

      {#if asset.kind === "vehicle" || data.insurance.length > 0}
        <AssetInsuranceCard
          assetId={asset.id}
          policies={data.insurance}
          today={data.today}
        />
      {/if}

      <LinkedDocsCard
        title={m.asset_docs_title()}
        pages={data.pages}
        createHref={newDocHref({ assetId: asset.id, section: "device" })}
        moreHref={docsFilterHref({ assetId: asset.id })}
        emptyTitle={m.asset_docs_empty_title()}
        emptyBody={m.asset_docs_empty_body()}
        createLabel={m.docs_create_page()}
        moreLabel={m.docs_show_all({ count: data.pages.length })}
        canWrite={canWriteDocs}
      />

      <Attachments
        ownerType="asset"
        ownerId={asset.id}
        title={m.asset_files_title()}
        primaryId={asset.photoAttachmentId}
        onprimary={setPhoto}
        onchange={() => invalidateAll()}
      />

      <LinkedDocuments ownerType="asset" ownerId={asset.id} />

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
        odometerUnit={data.vehicle?.details.odometerUnit ?? null}
      />

      <Comments entityType="asset" entityId={asset.id} />
    </div>

    <div class="min-w-0 lg:sticky lg:top-16">
      <QrCard {asset} origin={page.url.origin} />
    </div>
  </div>
</div>

{#if data.vehicle}
  <VehicleSetupDialog
    bind:open={setupOpen}
    assetId={asset.id}
    assetName={asset.name}
    firstRegistration={data.vehicle.details.firstRegistration}
    unit={data.vehicle.details.odometerUnit}
    today={data.today}
    tasks={data.tasks}
    onfinished={() => invalidateAll()}
  />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.asset_delete_title()}
  description={m.asset_delete_description({ name: asset.name })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
