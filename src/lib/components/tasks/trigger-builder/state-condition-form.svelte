<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TrendingDownIcon from "@lucide/svelte/icons/trending-down";
  import XIcon from "@lucide/svelte/icons/x";
  import type { ExternalEntity } from "$lib/connections/types";
  import EntityPicker from "$lib/components/connections/entity-picker.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { commonStates } from "$lib/connections/entities";
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
  let resolved = $state<ExternalEntity | null | undefined>();

  function setValue() {
    const text = valueText.trim();
    if (text === "") {
      trigger.value = undefined;
      return;
    }
    const numeric = Number(text.replace(",", "."));
    trigger.value = Number.isFinite(numeric) ? numeric : text;
  }

  function choose(state: string) {
    valueText = state;
    setValue();
  }

  const ops = $derived([
    { value: "eq", label: m.trigger_op_option_eq() },
    { value: "ne", label: m.trigger_op_option_ne() },
    { value: "gt", label: m.trigger_op_option_gt() },
    { value: "gte", label: m.trigger_op_option_gte() },
    { value: "lt", label: m.trigger_op_option_lt() },
    { value: "lte", label: m.trigger_op_option_lte() },
  ]);

  const directions = $derived([
    { value: "down", label: m.trigger_estimate_down() },
    { value: "up", label: m.trigger_estimate_up() },
  ]);

  const stateChips = $derived.by(() => {
    const domain = (trigger.entityId ?? "").split(".")[0] ?? "";
    const chips = commonStates(domain);
    const current = resolved?.state;
    if (
      current &&
      !chips.includes(current) &&
      Number.isNaN(Number(current)) &&
      current !== "unavailable" &&
      current !== "unknown"
    ) {
      chips.push(current);
    }
    return chips;
  });
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
      <EntityPicker
        id="trigger-entity"
        bind:value={trigger.entityId}
        placeholder="sensor.example_filter_pressure"
        {invalid}
        {describedby}
        onresolve={(entity) => (resolved = entity)}
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
        {#if stateChips.length > 0}
          <div
            class="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={m.trigger_form_value_suggestions()}
          >
            {#each stateChips as chip (chip)}
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-10 font-mono text-xs"
                onclick={() => choose(chip)}
              >
                {chip}
              </Button>
            {/each}
          </div>
        {/if}
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

  {#if trigger.estimateFrom}
    {@const estimate = trigger.estimateFrom}
    <div class="flex flex-col gap-4 rounded-lg border p-3 sm:p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <p class="flex items-center gap-2 text-sm font-medium">
            <TrendingDownIcon
              class="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            {m.trigger_estimate_title()}
          </p>
          <p class="text-muted-foreground text-xs text-pretty">
            {m.trigger_estimate_hint()}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-10 shrink-0"
          aria-label={m.trigger_estimate_remove()}
          onclick={() => (trigger.estimateFrom = undefined)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <Field
        id="trigger-estimate-entity"
        label={m.trigger_estimate_entity()}
        error={errors["estimateFrom.entityId"]}
      >
        {#snippet children({ describedby, invalid })}
          <EntityPicker
            id="trigger-estimate-entity"
            bind:value={estimate.entityId}
            placeholder="sensor.example_filter_remaining"
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field
          id="trigger-estimate-direction"
          label={m.trigger_estimate_direction()}
          error={errors["estimateFrom.direction"]}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="trigger-estimate-direction"
              value={estimate.direction}
              options={directions}
              {invalid}
              {describedby}
              onchange={(v) => (estimate.direction = v as "down" | "up")}
            />
          {/snippet}
        </Field>
        <Field
          id="trigger-estimate-target"
          label={m.trigger_estimate_target()}
          error={errors["estimateFrom.target"]}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="trigger-estimate-target"
              decimal
              bind:value={estimate.target}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>
    </div>
  {:else}
    <div>
      <Button
        type="button"
        variant="outline"
        onclick={() =>
          (trigger.estimateFrom = { entityId: "", direction: "down" })}
      >
        <PlusIcon />{m.trigger_estimate_add()}
      </Button>
    </div>
  {/if}
</div>
