<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import XIcon from "@lucide/svelte/icons/x";
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { monthName } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import ChipGroup from "../chip-group.svelte";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import Segmented from "../segmented.svelte";
  import type { IntervalUnit } from "$lib/tasks/engine/types";
  import type { IntervalDraft } from "./types";
  import { MONTHS, unitOptions } from "./options";

  let {
    trigger = $bindable(),
    errors,
    today,
  }: {
    trigger: IntervalDraft;
    errors: Record<string, string>;
    today: string;
  } = $props();

  const units = $derived(unitOptions());
  const presets = $derived([
    { every: 1, unit: "week", label: m.trigger_preset_weekly() },
    { every: 1, unit: "month", label: m.trigger_preset_monthly() },
    { every: 3, unit: "month", label: m.trigger_preset_quarterly() },
    { every: 6, unit: "month", label: m.trigger_preset_half_yearly() },
    { every: 1, unit: "year", label: m.trigger_preset_yearly() },
  ] as const);
  const presetChips = $derived(
    presets.map((preset, index) => ({ value: index, label: preset.label })),
  );
  const activePreset = $derived(
    presets.findIndex(
      (preset) =>
        preset.every === trigger.every && preset.unit === trigger.unit,
    ),
  );

  function applyPreset(index: number | undefined) {
    const preset = index === undefined ? undefined : presets[index];
    if (!preset) return;
    trigger.every = preset.every;
    trigger.unit = preset.unit;
  }
  const months = $derived(
    MONTHS.map((month) => ({
      value: String(month),
      label: monthName(month),
    })),
  );
  const seasons = $derived(trigger.seasons ?? []);

  function addSeason() {
    trigger.seasons = [
      ...seasons,
      { fromMonth: 11, toMonth: 3, every: 1, unit: "month" },
    ];
  }

  function removeSeason(index: number) {
    const next = seasons.filter((_, i) => i !== index);
    trigger.seasons = next.length > 0 ? next : undefined;
  }

  /** The extras stay folded away while they hold nothing but their defaults. */
  const hasExtras = $derived(
    trigger.anchor === "schedule" ||
      seasons.length > 0 ||
      (trigger.startDate !== undefined && trigger.startDate > today),
  );
  const extrasFailed = $derived(
    Boolean(errors.startDate) ||
      Object.keys(errors).some((key) => key.startsWith("seasons.")),
  );
  let extrasOpen = $state(untrack(() => hasExtras));

  $effect(() => {
    if (extrasFailed) extrasOpen = true;
  });
</script>

<div class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">{m.trigger_presets_label()}</span>
    <ChipGroup
      single
      label={m.trigger_presets_label()}
      options={presetChips}
      bind:selected={
        () => (activePreset >= 0 ? [activePreset] : []),
        (value) => applyPreset(value[0])
      }
    />
  </div>

  <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 sm:gap-4">
    <Field
      id="trigger-every"
      label={m.trigger_form_every()}
      error={errors.every}
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="trigger-every"
          bind:value={trigger.every}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field id="trigger-unit" label={m.trigger_form_unit()} error={errors.unit}>
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="trigger-unit"
          value={trigger.unit ?? ""}
          options={units}
          {invalid}
          {describedby}
          onchange={(v) => (trigger.unit = v as IntervalUnit)}
        />
      {/snippet}
    </Field>
  </div>

  <details
    class="group rounded-lg border px-3 max-sm:rounded-none max-sm:border-0 max-sm:border-y max-sm:px-0"
    bind:open={extrasOpen}
  >
    <summary
      class="text-muted-foreground focus-visible:ring-ring/50 min-h-11 cursor-pointer rounded py-3 text-sm font-medium outline-none select-none focus-visible:ring-[3px]"
    >
      {m.trigger_more_options()}
    </summary>
    <div class="flex flex-col gap-5 pt-2 pb-4">
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">{m.trigger_form_anchor()}</span>
        <Segmented
          label={m.trigger_form_anchor()}
          options={[
            { value: "completion", label: m.trigger_anchor_completion() },
            { value: "schedule", label: m.trigger_anchor_schedule() },
          ]}
          value={trigger.anchor ?? "completion"}
          onchange={(v) => (trigger.anchor = v)}
        />
        <p class="text-muted-foreground text-xs text-pretty">
          {trigger.anchor === "schedule"
            ? m.trigger_anchor_schedule_hint()
            : m.trigger_anchor_completion_hint()}
        </p>
      </div>

      <Field
        id="trigger-start"
        label={trigger.anchor === "schedule"
          ? m.trigger_form_start_schedule()
          : m.trigger_form_start_completion()}
        hint={trigger.anchor === "schedule"
          ? undefined
          : m.trigger_form_start_completion_hint()}
        error={errors.startDate}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="trigger-start"
            type="date"
            class="h-10"
            bind:value={trigger.startDate}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
          />
        {/snippet}
      </Field>

      <fieldset class="flex flex-col gap-3">
        <legend class="text-sm font-medium">{m.trigger_seasons()}</legend>
        <p class="text-muted-foreground -mt-1 text-xs text-pretty">
          {m.trigger_seasons_hint()}
        </p>
        {#each seasons as season, index (index)}
          <div
            class="bg-muted/40 grid grid-cols-2 gap-3 rounded-lg border p-3 max-sm:border-0 max-sm:p-2"
          >
            <Field
              id={`season-${index}-from`}
              label={m.trigger_season_from()}
              error={errors[`seasons.${index}.fromMonth`]}
            >
              {#snippet children({ describedby, invalid })}
                <OptionSelect
                  id={`season-${index}-from`}
                  value={String(season.fromMonth)}
                  options={months}
                  {invalid}
                  {describedby}
                  onchange={(v) => (season.fromMonth = Number(v))}
                />
              {/snippet}
            </Field>
            <Field
              id={`season-${index}-to`}
              label={m.trigger_season_to()}
              error={errors[`seasons.${index}.toMonth`]}
            >
              {#snippet children({ describedby, invalid })}
                <OptionSelect
                  id={`season-${index}-to`}
                  value={String(season.toMonth)}
                  options={months}
                  {invalid}
                  {describedby}
                  onchange={(v) => (season.toMonth = Number(v))}
                />
              {/snippet}
            </Field>
            <Field
              id={`season-${index}-every`}
              label={m.trigger_form_every()}
              error={errors[`seasons.${index}.every`]}
            >
              {#snippet children({ describedby, invalid })}
                <NumberField
                  id={`season-${index}-every`}
                  bind:value={season.every}
                  {invalid}
                  {describedby}
                />
              {/snippet}
            </Field>
            <Field
              id={`season-${index}-unit`}
              label={m.trigger_form_unit()}
              error={errors[`seasons.${index}.unit`]}
            >
              {#snippet children({ describedby, invalid })}
                <OptionSelect
                  id={`season-${index}-unit`}
                  value={season.unit}
                  options={units}
                  {invalid}
                  {describedby}
                  onchange={(v) => (season.unit = v as typeof season.unit)}
                />
              {/snippet}
            </Field>
            <div class="col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onclick={() => removeSeason(index)}
              >
                <XIcon />
                {m.trigger_season_remove()}
              </Button>
            </div>
          </div>
        {/each}
        {#if seasons.length < 12}
          <div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onclick={addSeason}
            >
              <PlusIcon />
              {m.trigger_season_add()}
            </Button>
          </div>
        {/if}
      </fieldset>
    </div>
  </details>
</div>
