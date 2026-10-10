<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { TriggerType } from "$lib/tasks/engine/types";
  import { getLocale } from "$lib/paraglide/runtime";
  import { describeTrigger } from "$lib/tasks/describe";
  import Field from "../field.svelte";
  import OptionSelect from "../option-select.svelte";
  import AutoCompleteEditor from "./auto-complete-editor.svelte";
  import CalendarForm from "./calendar-form.svelte";
  import CounterDeltaForm from "./counter-delta-form.svelte";
  import HaCalendarForm from "./ha-calendar-form.svelte";
  import IntervalForm from "./interval-form.svelte";
  import MinPerPeriodForm from "./min-per-period-form.svelte";
  import OneOffForm from "./one-off-form.svelte";
  import StateConditionForm from "./state-condition-form.svelte";
  import {
    ADVANCED_TYPES,
    defaultTrigger,
    EDITABLE_TYPES,
    hasAutoComplete,
    type TriggerDraft,
  } from "./types";
  import WarrantyForm from "./warranty-form.svelte";

  let {
    trigger = $bindable(),
    errors,
    today,
  }: {
    trigger: TriggerDraft;
    errors: Record<string, string>;
    today: string;
  } = $props();

  const typeLabels: Record<TriggerType, () => string> = {
    interval: () => m.trigger_type_interval(),
    calendar: () => m.trigger_type_calendar(),
    min_per_period: () => m.trigger_type_min_per_period(),
    one_off: () => m.trigger_type_one_off(),
    warranty: () => m.trigger_type_warranty(),
    counter_delta: () => m.trigger_type_counter_delta(),
    state_condition: () => m.trigger_type_state_condition(),
    ha_calendar: () => m.trigger_type_ha_calendar(),
    kept_bill: () => m.trigger_type_kept_bill(),
  };
  const typeHints: Record<TriggerType, () => string> = {
    interval: () => m.trigger_type_interval_hint(),
    calendar: () => m.trigger_type_calendar_hint(),
    min_per_period: () => m.trigger_type_min_per_period_hint(),
    one_off: () => m.trigger_type_one_off_hint(),
    warranty: () => m.trigger_type_warranty_hint(),
    counter_delta: () => m.trigger_type_counter_delta_hint(),
    state_condition: () => m.trigger_type_state_condition_hint(),
    ha_calendar: () => m.trigger_type_ha_calendar_hint(),
    kept_bill: () => m.trigger_type_kept_bill_hint(),
  };

  const options = $derived(
    EDITABLE_TYPES.map((type) => ({
      value: type,
      label: ADVANCED_TYPES.includes(type)
        ? `${typeLabels[type]()} (${m.trigger_advanced_badge()})`
        : typeLabels[type](),
    })),
  );

  function setType(type: string) {
    if (type === trigger.type) return;
    const next = defaultTrigger(type as TriggerType, today);
    const startDate = "startDate" in trigger ? trigger.startDate : undefined;
    if (startDate && "startDate" in next) next.startDate = startDate;
    trigger = next;
  }
</script>

<div class="flex flex-col gap-5">
  {#if trigger.type === "kept_bill"}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.trigger_managed()}
      <strong class="text-foreground font-medium"
        >{describeTrigger(trigger, getLocale())}</strong
      >
    </p>
  {:else}
    <Field
      id="trigger-type"
      label={m.trigger_form_type()}
      hint={typeHints[trigger.type]()}
    >
      {#snippet children({ describedby })}
        <div class="flex items-center gap-2">
          <OptionSelect
            id="trigger-type"
            value={trigger.type}
            {options}
            {describedby}
            onchange={setType}
          />
          {#if ADVANCED_TYPES.includes(trigger.type)}
            <Badge variant="secondary" class="shrink-0 max-sm:hidden"
              >{m.trigger_advanced_badge()}</Badge
            >
          {/if}
        </div>
      {/snippet}
    </Field>

    {#if trigger.type === "interval"}
      <IntervalForm bind:trigger {errors} {today} />
    {:else if trigger.type === "calendar"}
      <CalendarForm bind:trigger {errors} />
    {:else if trigger.type === "min_per_period"}
      <MinPerPeriodForm bind:trigger {errors} />
    {:else if trigger.type === "one_off"}
      <OneOffForm bind:trigger {errors} />
    {:else if trigger.type === "warranty"}
      <WarrantyForm bind:trigger {errors} />
    {:else if trigger.type === "counter_delta"}
      <CounterDeltaForm bind:trigger {errors} />
    {:else if trigger.type === "state_condition"}
      <StateConditionForm bind:trigger {errors} />
    {:else if trigger.type === "ha_calendar"}
      <HaCalendarForm bind:trigger {errors} />
    {/if}
    {#if hasAutoComplete(trigger)}
      <AutoCompleteEditor bind:trigger {errors} />
    {/if}
    {#if errors[""]}
      <p class="text-destructive text-xs text-pretty">{errors[""]}</p>
    {/if}
  {/if}
</div>
