<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import type { MinPerPeriodDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: MinPerPeriodDraft; errors: Record<string, string> } = $props();

  const periods = $derived([
    { value: "week", label: m.trigger_period_week_option() },
    { value: "month", label: m.trigger_period_month_option() },
    { value: "quarter", label: m.trigger_period_quarter_option() },
    { value: "year", label: m.trigger_period_year_option() },
  ]);
</script>

<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 sm:gap-4">
  <Field id="trigger-count" label={m.trigger_form_count()} error={errors.count}>
    {#snippet children({ describedby, invalid })}
      <NumberField
        id="trigger-count"
        bind:value={trigger.count}
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>
  <Field
    id="trigger-period"
    label={m.trigger_form_period()}
    error={errors.period}
  >
    {#snippet children({ describedby, invalid })}
      <OptionSelect
        id="trigger-period"
        value={trigger.period ?? ""}
        options={periods}
        {invalid}
        {describedby}
        onchange={(v) => (trigger.period = v as MinPerPeriodDraft["period"])}
      />
    {/snippet}
  </Field>
</div>
<p class="text-muted-foreground mt-3 text-xs text-pretty">
  {m.trigger_min_per_period_hint()}
</p>
