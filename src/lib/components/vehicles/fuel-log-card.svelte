<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import FuelIcon from "@lucide/svelte/icons/fuel";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { FUEL_UNITS, type FuelUnit } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { FuelLog } from "$lib/api/schemas/fuel-logs";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import type { VehicleStats } from "$lib/api/schemas/vehicle-stats";
  import type { Vehicle } from "$lib/api/schemas/vehicles";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import {
    formatConsumption,
    formatFuelQuantity,
    formatRate,
  } from "$lib/vehicles/fuel-format";
  import { formatOdometer } from "$lib/vehicles/format";
  import { priceSeries, type TrendPoint } from "$lib/vehicles/trend";
  import FuelLogFormDialog from "./fuel-log-form-dialog.svelte";
  import Sparkline from "./sparkline.svelte";

  let {
    assetId,
    logs,
    nextCursor,
    stats,
    vehicle,
    currency,
    today,
    people,
    currentUserId,
    canWrite,
  }: {
    assetId: string;
    logs: FuelLog[];
    nextCursor: string | null;
    stats: VehicleStats;
    vehicle: Vehicle;
    currency: string;
    today: string;
    people: DirectoryUser[];
    currentUserId: string;
    canWrite: boolean;
  } = $props();

  let formOpen = $state(false);
  let editing = $state<FuelLog | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<FuelLog | undefined>();

  let more = $state.raw<{
    base: FuelLog[];
    items: FuelLog[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  const loaded = $derived(more && more.base === logs ? more : null);
  const all = $derived([...logs, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : nextCursor);

  const unit = $derived(vehicle.odometerUnit);

  const panels = $derived(
    FUEL_UNITS.flatMap((fuel) => {
      const consumption = stats.consumption.find((c) => c.unit === fuel);
      const prices = stats.priceTrend.filter((p) => p.unit === fuel);
      if (!consumption && prices.length === 0) return [];
      return [
        {
          unit: fuel,
          consumption,
          consumptionSeries: (consumption?.last ?? []).map((s) => ({
            date: s.date,
            value: s.consumptionPer100,
          })),
          prices: priceSeries(stats.priceTrend, fuel),
        },
      ];
    }),
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.fuelLogsList, {
        params: { id: assetId },
        query: { limit: 20, cursor },
      });
      more = {
        base: logs,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(log: FuelLog) {
    editing = log;
    formOpen = true;
  }

  function askDelete(log: FuelLog) {
    deleting = log;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    await api.call(endpoints.fuelLogsDelete, { params: { id: deleting.id } });
    toast.success(m.fuel_deleted_toast());
    more = null;
    await invalidateAll();
  }

  const priceTitles: Record<FuelUnit, () => string> = {
    l: () => m.fuel_price_l(),
    kWh: () => m.fuel_price_kwh(),
  };

  function trendLabel(
    kind: "price" | "consumption",
    fuel: FuelUnit,
    series: TrendPoint[],
  ): string {
    const format = (value: number) =>
      kind === "price"
        ? formatRate(value, stats.costs.currency, fuel)
        : formatConsumption(value, fuel, unit);
    const values = series.map((p) => p.value);
    const params = {
      count: series.length,
      first: format(series[0].value),
      last: format(series[series.length - 1].value),
      min: format(Math.min(...values)),
      max: format(Math.max(...values)),
    };
    return kind === "price"
      ? m.fuel_trend_price_label(params)
      : m.fuel_trend_consumption_label(params);
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <FuelIcon class="text-muted-foreground size-5" aria-hidden="true" />
      {m.fuel_card_title()}
    </Card.Title>
    <Card.Description>{m.fuel_card_description()}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-5">
    {#if canWrite && all.length > 0}
      <Button size="lg" class="w-full sm:w-fit" onclick={openCreate}>
        <FuelIcon />{m.fuel_add()}
      </Button>
    {/if}

    {#each panels as panel (panel.unit)}
      <div
        class="bg-muted/40 grid gap-x-6 gap-y-5 rounded-xl border p-4 sm:grid-cols-2"
      >
        <div class="min-w-0">
          <p class="text-muted-foreground text-xs">{m.fuel_avg_title()}</p>
          {#if panel.consumption && panel.consumption.averagePer100 !== null}
            <p
              class="mt-0.5 text-2xl font-semibold tracking-tight wrap-anywhere tabular-nums"
            >
              {formatConsumption(
                panel.consumption.averagePer100,
                panel.unit,
                unit,
              )}
            </p>
            <p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
              {m.fuel_stretches({ count: panel.consumption.stretchCount })}
            </p>
            {#if panel.consumptionSeries.length >= 2}
              <Sparkline
                class="mt-2"
                points={panel.consumptionSeries}
                label={trendLabel(
                  "consumption",
                  panel.unit,
                  panel.consumptionSeries,
                )}
              />
              <p
                class="text-muted-foreground mt-1 flex justify-between gap-2 text-xs tabular-nums"
              >
                <span>{formatDay(panel.consumptionSeries[0].date)}</span>
                <span
                  >{formatDay(
                    panel.consumptionSeries[panel.consumptionSeries.length - 1]
                      .date,
                  )}</span
                >
              </p>
            {/if}
          {:else}
            <p class="mt-1 text-sm font-medium">{m.fuel_avg_none()}</p>
            <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
              {m.fuel_avg_none_hint()}
            </p>
          {/if}
        </div>
        <div class="min-w-0">
          <p class="text-muted-foreground text-xs">
            {priceTitles[panel.unit]()}
          </p>
          {#if panel.prices.length > 0}
            <p
              class="mt-0.5 text-2xl font-semibold tracking-tight wrap-anywhere tabular-nums"
            >
              {formatRate(
                panel.prices[panel.prices.length - 1].value,
                stats.costs.currency,
                panel.unit,
              )}
            </p>
            {#if panel.prices.length >= 2}
              <Sparkline
                class="mt-2"
                points={panel.prices}
                label={trendLabel("price", panel.unit, panel.prices)}
              />
              <p
                class="text-muted-foreground mt-1 flex justify-between gap-2 text-xs tabular-nums"
              >
                <span>{formatDay(panel.prices[0].date)}</span>
                <span
                  >{formatDay(panel.prices[panel.prices.length - 1].date)}</span
                >
              </p>
            {/if}
          {:else}
            <p class="mt-1 text-sm font-medium">{m.fuel_price_none()}</p>
          {/if}
        </div>
      </div>
    {/each}

    {#if all.length === 0}
      <EmptyState
        icon={FuelIcon}
        title={m.fuel_empty_title()}
        description={m.fuel_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          {#if canWrite}
            <Button size="lg" onclick={openCreate}>
              <PlusIcon />{m.fuel_add()}
            </Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y">
        {#each all as log (log.id)}
          <li class="flex items-start gap-2 py-3.5 first:pt-0 last:pb-0">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-sm font-medium tabular-nums">
                  {formatDay(log.date)}
                </span>
                {#if !log.fullTank}
                  <Badge variant="secondary">{m.fuel_partial()}</Badge>
                {/if}
                {#if log.missedPrevious}
                  <Badge variant="outline">{m.fuel_missed_badge()}</Badge>
                {/if}
              </div>
              {#if log.station}
                <p class="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                  {log.station}
                </p>
              {/if}
              <p class="mt-1 text-sm tabular-nums">
                {formatFuelQuantity(log.quantity, log.unit)}
                <span class="text-muted-foreground">
                  · {formatOdometer(log.odometer, log.odometerUnit)}
                </span>
              </p>
              {#if log.consumptionPer100 !== null && log.distance !== null}
                <p class="mt-1 text-xs font-medium tabular-nums">
                  <span class="text-brand">
                    {formatConsumption(
                      log.consumptionPer100,
                      log.unit,
                      log.odometerUnit,
                    )}
                  </span>
                  <span class="text-muted-foreground font-normal">
                    · {m.fuel_stretch({
                      distance: formatOdometer(log.distance, log.odometerUnit),
                    })}
                    {#if log.costPerDistanceMinor !== null}
                      · {formatRate(
                        log.costPerDistanceMinor,
                        log.currency,
                        log.odometerUnit,
                      )}
                    {/if}
                  </span>
                </p>
              {/if}
              {#if log.notes}
                <p
                  class="text-muted-foreground mt-1 text-xs wrap-anywhere whitespace-pre-line"
                >
                  {log.notes}
                </p>
              {/if}
            </div>
            <div class="shrink-0 text-end">
              <p class="text-sm font-medium tabular-nums">
                {log.amountMinor === 0
                  ? m.fuel_free()
                  : formatMoney(log.amountMinor, log.currency)}
              </p>
              {#if log.pricePerUnitMinor !== null && log.pricePerUnitMinor > 0}
                <p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
                  {formatRate(log.pricePerUnitMinor, log.currency, log.unit)}
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
                      aria-label={m.fuel_actions_aria({
                        date: formatDay(log.date),
                      })}
                    >
                      <EllipsisVerticalIcon />
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item
                    class="min-h-10"
                    onSelect={() => openEdit(log)}
                  >
                    <PencilIcon />{m.common_edit()}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    variant="destructive"
                    class="min-h-10"
                    onSelect={() => askDelete(log)}
                  >
                    <Trash2Icon />{m.common_delete()}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </li>
        {/each}
      </ul>
      {#if cursor}
        <div class="flex justify-center">
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

<FuelLogFormDialog
  bind:open={formOpen}
  {assetId}
  log={editing}
  fuelType={vehicle.fuelType}
  odometerUnit={unit}
  latest={vehicle.odometer}
  {currency}
  {today}
  {people}
  {currentUserId}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.fuel_delete_title()}
  description={m.fuel_delete_description({
    date: deleting ? formatDay(deleting.date) : "",
  })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
