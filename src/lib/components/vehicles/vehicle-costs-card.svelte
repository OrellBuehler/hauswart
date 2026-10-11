<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ReceiptIcon from "@lucide/svelte/icons/receipt";
  import WalletIcon from "@lucide/svelte/icons/wallet";
  import { untrack } from "svelte";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { VehicleStats } from "$lib/api/schemas/vehicle-stats";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { categoryIcons, categoryLabels } from "$lib/costs/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatPercent } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { costShare } from "$lib/vehicles/cost-card";
  import { formatRate } from "$lib/vehicles/fuel-format";
  import { formatOdometer } from "$lib/vehicles/format";
  import { newVehicleCostHref, vehicleCostsHref } from "$lib/vehicles/links";

  let {
    assetId,
    year: initialYear,
    stats,
    years,
    canAddCost,
  }: {
    assetId: string;
    year: number;
    stats: VehicleStats;
    years: number[];
    canAddCost: boolean;
  } = $props();

  let selected = $state(untrack(() => initialYear));
  let other = $state.raw<{ year: number; stats: VehicleStats } | undefined>();
  let loading = $state(false);
  let error = $state<string | undefined>();
  let attempt = $state(0);

  const shown = $derived(
    selected === initialYear
      ? stats
      : other?.year === selected
        ? other.stats
        : undefined,
  );

  $effect(() => {
    const year = selected;
    void attempt;
    void stats;
    if (year === initialYear) {
      other = undefined;
      error = undefined;
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    error = undefined;
    api
      .call(endpoints.vehicleStats, {
        params: { id: assetId },
        query: { year },
      })
      .then(
        (result) => {
          if (cancelled) return;
          other = { year, stats: result };
          loading = false;
        },
        (err) => {
          if (cancelled) return;
          error = apiErrorMessage(err);
          loading = false;
        },
      );
    return () => {
      cancelled = true;
    };
  });

  const yearOptions = $derived(
    [...new Set([initialYear, selected, ...years])]
      .sort((a, b) => b - a)
      .map((value) => ({ value: String(value), label: String(value) })),
  );
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <WalletIcon class="text-muted-foreground size-5" aria-hidden="true" />
      {m.vehicle_costs_title()}
    </Card.Title>
    <Card.Description>{m.vehicle_costs_description()}</Card.Description>
    <Card.Action>
      <div class="flex items-center gap-2">
        <Label for="vehicle-costs-year" class="sr-only">
          {m.vehicle_costs_year()}
        </Label>
        <OptionSelect
          id="vehicle-costs-year"
          class="w-28"
          options={yearOptions}
          bind:value={
            () => String(selected),
            (next) => {
              if (next) selected = Number(next);
            }
          }
        />
      </div>
    </Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-5" aria-busy={loading}>
    {#if error}
      <div
        class="flex flex-col items-center gap-3 py-8 text-center"
        role="alert"
      >
        <p class="text-destructive text-sm text-pretty">{error}</p>
        <Button
          variant="outline"
          onclick={() => {
            attempt += 1;
          }}
        >
          {m.common_retry()}
        </Button>
      </div>
    {:else if !shown}
      <div
        class="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
        role="status"
      >
        <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
        {m.common_loading()}
      </div>
    {:else}
      {@const costs = shown.costs}
      {#if costs.count === 0 && shown.distance === 0 && costs.otherCurrencyCount === 0}
        <EmptyState
          icon={ReceiptIcon}
          title={m.vehicle_costs_empty_title({ year: selected })}
          description={m.vehicle_costs_empty_body()}
          class="py-8"
        />
      {:else}
        <dl
          class="bg-muted/40 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-4 rounded-xl border p-4 sm:grid-cols-3"
        >
          <div class="col-span-2 min-w-0 sm:col-span-1">
            <dt class="text-muted-foreground text-xs">
              {m.vehicle_costs_total()}
            </dt>
            <dd
              class="mt-0.5 text-2xl font-semibold tracking-tight wrap-anywhere tabular-nums"
            >
              {formatMoney(costs.totalMinor, costs.currency)}
            </dd>
            <dd class="text-muted-foreground mt-0.5 text-xs tabular-nums">
              {m.vehicle_costs_count({ count: costs.count })}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.vehicle_costs_distance()}
            </dt>
            <dd
              class="mt-0.5 text-base font-semibold wrap-anywhere tabular-nums"
            >
              {formatOdometer(Math.round(shown.distance), shown.odometerUnit)}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.vehicle_costs_per_distance({ unit: shown.odometerUnit })}
            </dt>
            <dd
              class="mt-0.5 text-base font-semibold wrap-anywhere tabular-nums"
            >
              {#if shown.costPerDistanceMinor !== null}
                {formatRate(
                  shown.costPerDistanceMinor,
                  costs.currency,
                  shown.odometerUnit,
                )}
              {:else}
                <span class="text-muted-foreground">–</span>
              {/if}
            </dd>
          </div>
        </dl>

        {#if costs.byCategory.length > 0}
          <ul class="flex flex-col gap-3">
            {#each costs.byCategory as row (row.category)}
              {@const Icon = categoryIcons[row.category]}
              <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5">
                <span class="flex min-w-0 items-center gap-2 text-sm">
                  <Icon
                    class="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 wrap-anywhere">
                    {categoryLabels[row.category]()}
                  </span>
                </span>
                <span class="text-sm font-medium tabular-nums">
                  {formatMoney(row.totalMinor, costs.currency)}
                </span>
                <span
                  class="bg-muted col-span-2 block h-1.5 overflow-hidden rounded-full"
                >
                  <span
                    class="bg-brand block h-full rounded-full"
                    style="width: {Math.max(
                      2,
                      costShare(costs.totalMinor, row.totalMinor),
                    )}%"
                  ></span>
                </span>
                <span class="sr-only">
                  {formatPercent(
                    costShare(costs.totalMinor, row.totalMinor) * 100,
                  )} %
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if costs.otherCurrencyCount > 0}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.vehicle_costs_other_currency({
              count: costs.otherCurrencyCount,
              currency: costs.currency,
            })}
          </p>
        {/if}
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button
          href={vehicleCostsHref(assetId, selected)}
          variant="outline"
          size="lg"
          class="max-sm:flex-1"
        >
          <ReceiptIcon />{m.vehicle_costs_show_all()}
        </Button>
        {#if canAddCost}
          <Button
            href={newVehicleCostHref(assetId)}
            variant="outline"
            size="lg"
            class="max-sm:flex-1"
          >
            <PlusIcon />{m.vehicle_costs_add()}
          </Button>
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
