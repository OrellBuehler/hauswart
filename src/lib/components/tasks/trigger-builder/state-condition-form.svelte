<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import AdvancedNote from "./advanced-note.svelte";
  import type { StateConditionDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: StateConditionDraft; errors: Record<string, string> } =
    $props();

  let valueText = $state(
    trigger.value === undefined ? "" : String(trigger.value),
  );

  function setValue() {
    const text = valueText.trim();
    if (text === "") {
      trigger.value = undefined;
      return;
    }
    const numeric = Number(text.replace(",", "."));
    trigger.value = Number.isFinite(numeric) ? numeric : text;
  }

  const ops = $derived([
    { value: "eq", label: m.trigger_op_option_eq() },
    { value: "ne", label: m.trigger_op_option_ne() },
    { value: "gt", label: m.trigger_op_option_gt() },
    { value: "gte", label: m.trigger_op_option_gte() },
    { value: "lt", label: m.trigger_op_option_lt() },
    { value: "lte", label: m.trigger_op_option_lte() },
  ]);
</script>

<div class="flex flex-col gap-4">
  <AdvancedNote />
  <Field
    id="trigger-entity"
    label={m.trigger_form_state_entity()}
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
        placeholder="sensor.filter_pressure"
        bind:value={trigger.entityId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
  <div class="grid gap-4 sm:grid-cols-2">
    <Field id="trigger-op" label={m.trigger_form_op()} error={errors.op}>
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="trigger-op"
          value={trigger.op ?? ""}
          options={ops}
          {invalid}
          {describedby}
          onchange={(v) => (trigger.op = v as StateConditionDraft["op"])}
        />
      {/snippet}
    </Field>
    <Field
      id="trigger-value"
      label={m.trigger_form_value()}
      hint={m.trigger_form_value_hint()}
      error={errors.value}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="trigger-value"
          class="h-10"
          autocomplete="off"
          value={valueText}
          oninput={(event) => {
            valueText = event.currentTarget.value;
            setValue();
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>
  </div>
  <Field
    id="trigger-for"
    label={m.trigger_form_for_minutes()}
    hint={m.trigger_form_for_minutes_hint()}
    optional
    error={errors.forMinutes}
    class="sm:max-w-xs"
  >
    {#snippet children({ describedby, invalid })}
      <NumberField
        id="trigger-for"
        bind:value={trigger.forMinutes}
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>
</div>
