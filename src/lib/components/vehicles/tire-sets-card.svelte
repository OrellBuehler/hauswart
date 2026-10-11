<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import CircleDotIcon from "@lucide/svelte/icons/circle-dot";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import RulerIcon from "@lucide/svelte/icons/ruler";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { TireSet } from "$lib/api/schemas/tire-sets";
  import type { Vehicle } from "$lib/api/schemas/vehicles";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay, formatNumber } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import { formatOdometer } from "$lib/vehicles/format";
  import { tireSeasonIcons } from "$lib/vehicles/labels";
  import type { VehicleReadingState } from "$lib/vehicles/odometer-state.svelte";
  import { setMake, setTitle } from "$lib/vehicles/tire-label";
  import {
    mountedSet,
    tireWarnings,
    type TireWarning,
  } from "$lib/vehicles/tire-view";
  import { TIRE_AGE_WARNING_YEARS } from "$lib/vehicles/tires";
  import TireMountDialog from "./tire-mount-dialog.svelte";
  import TireSetFormDialog from "./tire-set-form-dialog.svelte";
  import TireTreadDialog from "./tire-tread-dialog.svelte";

  let {
    assetId,
    sets,
    vehicle,
    today,
    canWrite,
  }: {
    assetId: string;
    sets: TireSet[];
    vehicle: Vehicle;
    today: string;
    canWrite: boolean;
  } = $props();

  let formOpen = $state(false);
  let editing = $state<TireSet | undefined>();
  let mountOpen = $state(false);
  let mounting = $state<TireSet | undefined>();
  let treadOpen = $state(false);
  let measuring = $state<TireSet | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<TireSet | undefined>();
  let retireOpen = $state(false);
  let retiring = $state<TireSet | undefined>();
  let showRetired = $state(false);
  let busyId = $state<string | undefined>();

  const active = $derived(sets.filter((set) => set.retiredAt === null));
  const retired = $derived(sets.filter((set) => set.retiredAt !== null));
  const visible = $derived(showRetired ? sets : active);
  const mounted = $derived(mountedSet(sets));
  const warnings = $derived(
    active.flatMap((set) =>
      tireWarnings(set).map((warning) => ({ set, warning })),
    ),
  );
  const reading = $derived<VehicleReadingState>({
    phase: "ready",
    unit: vehicle.odometerUnit,
    latest: vehicle.odometer
      ? { value: vehicle.odometer.value, date: vehicle.odometer.date }
      : null,
  });

  function warningText(warning: TireWarning): string {
    return warning.kind === "tread"
      ? m.tire_warning_tread({
          depth: formatNumber(warning.depthMm),
          limit: formatNumber(warning.limitMm),
        })
      : m.tire_warning_age({
          years: formatNumber(warning.years),
          limit: TIRE_AGE_WARNING_YEARS,
        });
  }

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(set: TireSet) {
    editing = set;
    formOpen = true;
  }

  function openMount(set: TireSet) {
    mounting = set;
    mountOpen = true;
  }

  function openTread(set: TireSet) {
    measuring = set;
    treadOpen = true;
  }

  function askDelete(set: TireSet) {
    deleting = set;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    await api.call(endpoints.tireSetsDelete, { params: { id: deleting.id } });
    toast.success(m.tire_deleted_toast());
    await invalidateAll();
  }

  async function changeRetired(set: TireSet, value: boolean) {
    await api.call(endpoints.tireSetsUpdate, {
      params: { id: set.id },
      body: { retired: value },
    });
    toast.success(value ? m.tire_retired_toast() : m.tire_unretired_toast());
    await invalidateAll();
  }

  async function setRetired(set: TireSet, value: boolean) {
    if (busyId) return;
    busyId = set.id;
    try {
      await changeRetired(set, value);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = undefined;
    }
  }

  function retire(set: TireSet) {
    if (set.mounted) {
      retiring = set;
      retireOpen = true;
    } else {
      void setRetired(set, true);
    }
  }
</script>

{#snippet facts(set: TireSet)}
  <dl
    class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:gap-x-6"
  >
    <div class="min-w-0">
      <dt class="text-muted-foreground text-xs">{m.tire_fact_tread()}</dt>
      <dd
        class={cn(
          "mt-0.5 font-medium wrap-anywhere tabular-nums",
          set.treadWarning && set.retiredAt === null && "text-destructive",
        )}
      >
        {#if set.treadDepthMm !== null}
          {#if set.treadWarning && set.retiredAt === null}
            <TriangleAlertIcon
              class="me-1 inline size-3.5 align-text-bottom"
              aria-hidden="true"
            />
          {/if}
          {m.tire_fact_tread_value({ depth: formatNumber(set.treadDepthMm) })}
          {#if set.treadMeasuredOn}
            <span class="text-muted-foreground block text-xs font-normal">
              {m.tire_fact_tread_date({ date: formatDay(set.treadMeasuredOn) })}
            </span>
          {/if}
        {:else}
          <span class="text-muted-foreground font-normal"
            >{m.tire_fact_tread_none()}</span
          >
        {/if}
      </dd>
    </div>
    <div class="min-w-0">
      <dt class="text-muted-foreground text-xs">{m.tire_fact_age()}</dt>
      <dd
        class={cn(
          "mt-0.5 font-medium wrap-anywhere tabular-nums",
          set.ageYears !== null &&
            set.ageYears >= TIRE_AGE_WARNING_YEARS &&
            set.retiredAt === null &&
            "text-warning",
        )}
      >
        {#if set.ageYears !== null}
          {m.tire_fact_age_value({ years: formatNumber(set.ageYears) })}
          {#if set.dot}
            <span class="text-muted-foreground block text-xs font-normal">
              {m.tire_fact_dot({ dot: set.dot })}
            </span>
          {/if}
        {:else}
          <span class="text-muted-foreground font-normal"
            >{m.tire_fact_age_none()}</span
          >
        {/if}
      </dd>
    </div>
    {#if set.mounted && set.mountedOn}
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">
          {m.tire_fact_mounted_since()}
        </dt>
        <dd class="mt-0.5 font-medium tabular-nums">
          {formatDay(set.mountedOn)}
        </dd>
      </div>
    {/if}
    {#if set.distance !== null && set.distance > 0}
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{m.tire_fact_distance()}</dt>
        <dd class="mt-0.5 font-medium tabular-nums">
          {formatOdometer(set.distance, set.odometerUnit)}
        </dd>
      </div>
    {/if}
    {#if set.storageLocation || set.storageContactName}
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{m.tire_fact_storage()}</dt>
        <dd class="mt-0.5 font-medium wrap-anywhere">
          {[set.storageLocation, set.storageContactName]
            .filter(Boolean)
            .join(" · ")}
        </dd>
      </div>
    {/if}
    {#if set.purchasedOn}
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{m.tire_fact_purchased()}</dt>
        <dd class="mt-0.5 font-medium tabular-nums">
          {formatDay(set.purchasedOn)}
        </dd>
      </div>
    {/if}
  </dl>
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <CircleDotIcon class="text-muted-foreground size-5" aria-hidden="true" />
      {m.tire_card_title()}
    </Card.Title>
    {#if sets.length > 0}
      <Card.Description>
        {#if mounted}
          {m.tire_card_mounted({
            name: setTitle(mounted),
            date: mounted.mountedOn ? formatDay(mounted.mountedOn) : "",
          })}
        {:else}
          {m.tire_card_none_mounted()}
        {/if}
      </Card.Description>
    {/if}
    {#if canWrite}
      <Card.Action>
        <Button size="sm" variant="outline" onclick={openCreate}>
          <PlusIcon />{m.tire_add()}
        </Button>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if warnings.length > 0}
      <Alert.Root variant="destructive" class="border-destructive/40">
        <TriangleAlertIcon />
        <Alert.Title>{m.tire_alert_title()}</Alert.Title>
        <Alert.Description>
          <ul class="flex flex-col gap-1">
            {#each warnings as { set, warning } (set.id + warning.kind)}
              <li class="wrap-anywhere">
                <span class="font-medium">{setTitle(set)}:</span>
                {warningText(warning)}
              </li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if sets.length === 0}
      <EmptyState
        icon={CircleDotIcon}
        title={m.tire_empty_title()}
        description={m.tire_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          {#if canWrite}
            <Button onclick={openCreate}><PlusIcon />{m.tire_add()}</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y">
        {#each visible as set (set.id)}
          {@const SeasonIcon = tireSeasonIcons[set.season]}
          {@const make = setMake(set)}
          <li class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <div class="flex items-start gap-3">
              <span
                class={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  set.mounted
                    ? "bg-brand text-brand-foreground"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                <SeasonIcon class="size-5" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 class="font-medium wrap-anywhere">{setTitle(set)}</h3>
                  {#if set.mounted}
                    <Badge
                      variant="outline"
                      class="border-brand/40 bg-brand/10 text-brand"
                    >
                      {m.tire_badge_mounted()}
                    </Badge>
                  {:else if set.retiredAt}
                    <Badge variant="secondary">{m.tire_badge_retired()}</Badge>
                  {/if}
                </div>
                {#if make}
                  <p class="text-muted-foreground text-xs wrap-anywhere">
                    {make}
                  </p>
                {/if}
              </div>
              {#if canWrite}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon"
                        class="-me-1.5"
                        aria-label={m.tire_actions_aria({
                          name: setTitle(set),
                        })}
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      class="min-h-10"
                      onSelect={() => openEdit(set)}
                    >
                      <PencilIcon />{m.common_edit()}
                    </DropdownMenu.Item>
                    {#if set.retiredAt}
                      <DropdownMenu.Item
                        class="min-h-10"
                        onSelect={() => setRetired(set, false)}
                      >
                        <RotateCcwIcon />{m.tire_unretire()}
                      </DropdownMenu.Item>
                    {:else}
                      <DropdownMenu.Item
                        class="min-h-10"
                        onSelect={() => retire(set)}
                      >
                        <ArchiveIcon />{m.tire_retire()}
                      </DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      variant="destructive"
                      class="min-h-10"
                      onSelect={() => askDelete(set)}
                    >
                      <Trash2Icon />{m.common_delete()}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </div>
            {@render facts(set)}
            {#if canWrite && set.retiredAt === null}
              <div class="flex flex-wrap gap-2">
                {#if !set.mounted}
                  <Button
                    size="lg"
                    variant="outline"
                    class="max-sm:flex-1"
                    disabled={busyId === set.id}
                    onclick={() => openMount(set)}
                  >
                    <CircleDotIcon />{m.tire_mount()}
                  </Button>
                {/if}
                <Button
                  size="lg"
                  variant="outline"
                  class="max-sm:flex-1"
                  disabled={busyId === set.id}
                  onclick={() => openTread(set)}
                >
                  <RulerIcon />{m.tire_measure()}
                </Button>
              </div>
            {/if}
            {#if set.notes}
              <p
                class="text-muted-foreground text-sm wrap-anywhere whitespace-pre-line"
              >
                {set.notes}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if retired.length > 0}
        <div class="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showRetired}
            onclick={() => (showRetired = !showRetired)}
          >
            {showRetired
              ? m.tire_hide_retired()
              : m.tire_show_retired({ count: retired.length })}
          </Button>
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<TireSetFormDialog
  bind:open={formOpen}
  {assetId}
  set={editing}
  {vehicle}
  {today}
  onsaved={() => invalidateAll()}
/>

<TireMountDialog
  bind:open={mountOpen}
  {assetId}
  set={mounting}
  {today}
  vehicle={reading}
  onmounted={() => invalidateAll()}
/>

<TireTreadDialog
  bind:open={treadOpen}
  set={measuring}
  {today}
  vehicle={reading}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.tire_delete_title()}
  description={m.tire_delete_description({
    name: deleting ? setTitle(deleting) : "",
  })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>

<ConfirmDialog
  bind:open={retireOpen}
  title={m.tire_retire_title()}
  description={m.tire_retire_description({
    name: retiring ? setTitle(retiring) : "",
  })}
  confirmLabel={m.tire_retire()}
  pendingLabel={m.tire_retiring()}
  onconfirm={async () => {
    if (retiring) await changeRetired(retiring, true);
  }}
/>
