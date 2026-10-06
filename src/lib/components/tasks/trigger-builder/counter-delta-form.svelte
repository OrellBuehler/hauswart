<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import AdvancedNote from "./advanced-note.svelte";
  import type { CounterDeltaDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: CounterDeltaDraft; errors: Record<string, string> } = $props();

  let unit = $state(trigger.unit ?? "");

  $effect(() => {
    trigger.unit = unit.trim() === "" ? undefined : unit;
  });
</script>

<div class="flex flex-col gap-4">
  <AdvancedNote />
  <Field
    id="trigger-entity"
    label={m.trigger_form_counter_entity()}
    hint={m.trigger_form_entity_hint()}
    error={errors.entityId}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="trigger-entity"
        class="h-10 font-mono"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        placeholder="sensor.washer_cycles"
        bind:value={trigger.entityId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
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
</div>
