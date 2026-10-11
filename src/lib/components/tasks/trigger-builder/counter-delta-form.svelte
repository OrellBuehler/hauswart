<script lang="ts">
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import EntityPicker from "$lib/components/connections/entity-picker.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { IntervalUnit } from "$lib/tasks/engine/types";
  import { odometerSignalKey } from "$lib/vehicles/odometer";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import Segmented from "../segmented.svelte";
  import AdvancedNote from "./advanced-note.svelte";
  import { unitOptions } from "./options";
  import type { CounterDeltaDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
    vehicle,
  }: {
    trigger: CounterDeltaDraft;
    errors: Record<string, string>;
    /** The vehicle the task belongs to: its odometer can be the counter. */
    vehicle?: { id: string; name: string; unit: string } | undefined;
  } = $props();

  let unit = $state(trigger.unit ?? "");

  $effect(() => {
    trigger.unit = unit.trim() === "" ? undefined : unit;
  });

  const usesOdometer = $derived(
    vehicle !== undefined && trigger.entityId === odometerSignalKey(vehicle.id),
  );
  const sourceOptions = $derived([
    {
      value: "odometer" as const,
      label: m.trigger_form_counter_odometer(),
    },
    { value: "entity" as const, label: m.trigger_form_counter_entity_ha() },
  ]);
  const units = $derived(unitOptions());

  function pickSource(next: "odometer" | "entity") {
    if (!vehicle) return;
    if (next === "odometer") {
      trigger.entityId = odometerSignalKey(vehicle.id);
      unit = vehicle.unit;
    } else {
      trigger.entityId = "";
    }
  }

  function setOrEvery(on: boolean) {
    trigger.orEvery = on ? { every: 12, unit: "month" } : undefined;
  }
</script>

<div class="flex flex-col gap-4">
  {#if vehicle}
    <div class="flex flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.trigger_form_counter_source()}</span
      >
      <Segmented
        label={m.trigger_form_counter_source()}
        options={sourceOptions}
        value={usesOdometer ? "odometer" : "entity"}
        onchange={pickSource}
      />
    </div>
  {:else}
    <AdvancedNote />
  {/if}

  {#if usesOdometer}
    <p class="text-muted-foreground text-xs text-pretty">
      {m.trigger_form_counter_odometer_hint()}
    </p>
  {:else}
    {#if vehicle}
      <AdvancedNote />
    {/if}
    <Field
      id="trigger-entity"
      label={m.trigger_form_counter_entity()}
      hint={m.trigger_form_counter_entity_hint()}
      error={errors.entityId}
    >
      {#snippet children({ describedby, invalid })}
        <EntityPicker
          id="trigger-entity"
          bind:value={trigger.entityId}
          placeholder="sensor.example_counter"
          {invalid}
          {describedby}
          onpick={(entity) => {
            if (entity?.unit && unit.trim() === "") unit = entity.unit;
          }}
        />
      {/snippet}
    </Field>
    {#if !vehicle}
      <p class="text-muted-foreground -mt-2 text-xs text-pretty">
        {m.trigger_form_counter_vehicle_tip()}
      </p>
    {/if}
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    <Field
      id="trigger-threshold"
      label={m.trigger_form_threshold()}
      hint={m.trigger_form_threshold_hint()}
      error={errors.threshold}
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="trigger-threshold"
          decimal
          bind:value={trigger.threshold}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field
      id="trigger-counter-unit"
      label={m.trigger_form_counter_unit()}
      optional
      error={errors.unit}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="trigger-counter-unit"
          class="h-10"
          autocomplete="off"
          placeholder={m.trigger_form_counter_unit_placeholder()}
          bind:value={unit}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>
  </div>

  <div class="flex flex-col gap-3">
    <SwitchField
      id="trigger-or-every"
      checked={trigger.orEvery !== undefined}
      label={m.trigger_form_or_every()}
      hint={m.trigger_form_or_every_hint()}
      onchange={setOrEvery}
    />
    {#if trigger.orEvery}
      {@const orEvery = trigger.orEvery}
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 sm:gap-4">
        <Field
          id="trigger-or-every-every"
          label={m.trigger_form_or_every_every()}
          error={errors["orEvery.every"]}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="trigger-or-every-every"
              bind:value={orEvery.every}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="trigger-or-every-unit"
          label={m.trigger_form_unit()}
          error={errors["orEvery.unit"]}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="trigger-or-every-unit"
              value={orEvery.unit}
              options={units}
              {invalid}
              {describedby}
              onchange={(next) => (orEvery.unit = next as IntervalUnit)}
            />
          {/snippet}
        </Field>
      </div>
    {/if}
  </div>
</div>
