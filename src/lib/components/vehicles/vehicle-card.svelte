<script lang="ts">
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { Vehicle } from "$lib/api/schemas/vehicles";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { formatOdometer } from "$lib/vehicles/format";
  import { fuelLabels } from "$lib/vehicles/labels";
  import OdometerDialog from "./odometer-dialog.svelte";

  let {
    assetId,
    vehicle,
    today,
    canWrite,
  }: {
    assetId: string;
    vehicle: Vehicle;
    today: string;
    canWrite: boolean;
  } = $props();

  let recordOpen = $state(false);

  const odometer = $derived(vehicle.odometer);
  const facts = $derived(
    (
      [
        [m.vehicle_vin(), vehicle.vin],
        [m.vehicle_registration_number(), vehicle.registrationNumber],
        [
          m.vehicle_first_registration(),
          vehicle.firstRegistration
            ? formatDay(vehicle.firstRegistration)
            : null,
        ],
        [
          m.vehicle_fuel(),
          vehicle.fuelType ? fuelLabels[vehicle.fuelType]() : null,
        ],
        [m.vehicle_tire_summer(), vehicle.tireSizeSummer],
        [m.vehicle_tire_winter(), vehicle.tireSizeWinter],
        [m.vehicle_location(), vehicle.location],
      ] as const
    ).flatMap(([label, value]) => (value ? [[label, value] as const] : [])),
  );
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <GaugeIcon class="text-muted-foreground size-5" aria-hidden="true" />
      {m.vehicle_card_title()}
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-5">
    <div
      class="bg-muted/40 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 rounded-xl border p-4"
    >
      <div class="min-w-0">
        <p class="text-muted-foreground text-xs">
          {m.vehicle_odometer_title()}
        </p>
        {#if odometer}
          <p
            class="mt-0.5 text-3xl font-semibold tracking-tight wrap-anywhere tabular-nums"
          >
            {formatOdometer(odometer.value, odometer.unit)}
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            {m.vehicle_odometer_as_of({ date: formatDay(odometer.date) })}
          </p>
        {:else}
          <p class="mt-1 text-sm font-medium">{m.vehicle_odometer_none()}</p>
          <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
            {m.vehicle_odometer_none_hint()}
          </p>
        {/if}
      </div>
      {#if canWrite}
        <Button size="lg" onclick={() => (recordOpen = true)}>
          <GaugeIcon />{m.vehicle_record_odometer()}
        </Button>
      {/if}
    </div>

    {#if facts.length > 0}
      <dl
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:gap-x-6"
      >
        {#each facts as [label, value] (label)}
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{label}</dt>
            <dd class="mt-0.5 font-medium wrap-anywhere">{value}</dd>
          </div>
        {/each}
      </dl>
    {:else if canWrite}
      <div class="flex flex-col items-start gap-2">
        <p class="text-muted-foreground text-sm text-pretty">
          {m.vehicle_facts_empty()}
        </p>
        <Button
          href={resolve(`/assets/${assetId}/edit` as "/")}
          variant="outline"
          size="sm"
        >
          <PencilIcon />{m.vehicle_facts_edit()}
        </Button>
      </div>
    {/if}

    {#if vehicle.notes}
      <div class="border-t pt-4">
        <h3 class="text-muted-foreground mb-1.5 text-sm">
          {m.vehicle_notes()}
        </h3>
        <p class="text-sm wrap-anywhere whitespace-pre-line">{vehicle.notes}</p>
      </div>
    {/if}
  </Card.Content>
</Card.Root>

<OdometerDialog
  bind:open={recordOpen}
  {assetId}
  unit={vehicle.odometerUnit}
  {today}
  latest={odometer}
  onsaved={() => invalidateAll()}
/>
