<script lang="ts">
  import Field from "$lib/components/tasks/field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { formatOdometer } from "$lib/vehicles/format";
  import type { VehicleReadingState } from "$lib/vehicles/odometer-state.svelte";
  import { readingText } from "$lib/vehicles/odometer-input";

  let {
    id,
    value = $bindable(""),
    vehicle,
    label,
    error,
    optional = true,
    onkeydown,
    enterkeyhint,
  }: {
    id: string;
    value?: string;
    vehicle: VehicleReadingState;
    label?: string;
    error?: string | undefined;
    optional?: boolean;
    onkeydown?: (event: KeyboardEvent) => void;
    enterkeyhint?: "next" | "done" | "go";
  } = $props();

  let touched = $state(false);

  $effect(() => {
    if (vehicle.phase === "ready" && !touched && value === "") {
      value = readingText(vehicle.latest?.value);
    }
  });

  const unit = $derived(vehicle.phase === "ready" ? vehicle.unit : "km");
  const hint = $derived(
    vehicle.phase === "loading"
      ? m.common_loading()
      : vehicle.phase === "error"
        ? vehicle.message
        : vehicle.latest
          ? m.vehicle_odometer_prefilled({
              value: formatOdometer(vehicle.latest.value, vehicle.unit),
              date: formatDay(vehicle.latest.date),
            })
          : m.vehicle_odometer_none_hint(),
  );
</script>

<Field
  {id}
  label={label ?? m.vehicle_odometer_value({ unit })}
  {optional}
  {hint}
  {error}
>
  {#snippet children({ describedby, invalid })}
    <Input
      {id}
      type="text"
      inputmode="decimal"
      autocomplete="off"
      {enterkeyhint}
      class="h-10 tabular-nums"
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
      {onkeydown}
      oninput={() => (touched = true)}
      bind:value
    />
  {/snippet}
</Field>
