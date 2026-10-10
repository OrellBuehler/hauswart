<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { isValidDate, parseDate, weekday } from "$lib/dates";
  import { formatOrdinalDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import ChipGroup from "../chip-group.svelte";
  import Field from "../field.svelte";
  import NumberField from "../number-field.svelte";
  import OptionSelect from "../option-select.svelte";
  import Segmented from "../segmented.svelte";
  import { monthChips, weekdayChips } from "./options";
  import type { CalendarDraft } from "./types";

  let {
    trigger = $bindable(),
    errors,
  }: { trigger: CalendarDraft; errors: Record<string, string> } = $props();

  type Freq = "weekly" | "monthly" | "yearly";

  /** Below `sm` the chips share the row evenly instead of wrapping raggedly. */
  const weekdayGrid =
    "max-sm:grid max-sm:grid-cols-7 max-sm:[&>button]:min-w-0 max-sm:[&>button]:px-0";
  const monthGrid =
    "max-sm:grid max-sm:grid-cols-6 max-sm:[&>button]:min-w-0 max-sm:[&>button]:px-0";

  const freq = $derived(trigger.freq ?? "weekly");
  const dayMode = $derived(trigger.nth !== undefined ? "nth" : "day");
  const start = $derived(
    trigger.startDate && isValidDate(trigger.startDate)
      ? parseDate(trigger.startDate)
      : null,
  );

  const freqOptions = $derived([
    { value: "weekly" as Freq, label: m.trigger_freq_weekly() },
    { value: "monthly" as Freq, label: m.trigger_freq_monthly() },
    { value: "yearly" as Freq, label: m.trigger_freq_yearly() },
  ]);
  const intervalUnit = $derived(
    freq === "weekly"
      ? m.trigger_unit_weeks()
      : freq === "monthly"
        ? m.trigger_unit_months()
        : m.trigger_unit_years(),
  );
  const dayOptions = $derived([
    ...Array.from({ length: 31 }, (_, i) => ({
      value: String(i + 1),
      label: formatOrdinalDay(i + 1, getLocale()),
    })),
    { value: "-1", label: m.trigger_day_last() },
    { value: "-2", label: m.trigger_day_second_last() },
  ]);
  const nthOptions = $derived([
    { value: "1", label: m.trigger_nth_first() },
    { value: "2", label: m.trigger_nth_second() },
    { value: "3", label: m.trigger_nth_third() },
    { value: "4", label: m.trigger_nth_fourth() },
    { value: "-1", label: m.trigger_nth_last() },
  ]);

  function setFreq(next: Freq) {
    trigger.freq = next;
    if (next === "weekly") {
      trigger.byMonthDay = undefined;
      trigger.nth = undefined;
      trigger.byMonth = undefined;
      trigger.byWeekday =
        trigger.byWeekday && trigger.byWeekday.length > 0
          ? trigger.byWeekday
          : [start ? weekday(trigger.startDate as string) : 1];
      return;
    }
    if (trigger.nth === undefined) {
      trigger.byWeekday = undefined;
      trigger.byMonthDay = trigger.byMonthDay ?? start?.day ?? 1;
    }
    trigger.byMonth =
      next === "yearly"
        ? trigger.byMonth && trigger.byMonth.length > 0
          ? trigger.byMonth
          : [start?.month ?? 1]
        : trigger.byMonth;
  }

  function setDayMode(next: "day" | "nth") {
    if (next === "nth") {
      trigger.byMonthDay = undefined;
      trigger.nth = 1;
      trigger.byWeekday = [start ? weekday(trigger.startDate as string) : 1];
    } else {
      trigger.nth = undefined;
      trigger.byWeekday = undefined;
      trigger.byMonthDay = start?.day ?? 1;
    }
  }
</script>

<div class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <span class="text-sm font-medium">{m.trigger_form_freq()}</span>
    <Segmented
      label={m.trigger_form_freq()}
      options={freqOptions}
      value={freq}
      onchange={setFreq}
    />
  </div>

  <Field
    id="trigger-interval"
    label={m.trigger_form_repeat()}
    error={errors.interval}
  >
    {#snippet children({ describedby, invalid })}
      <div class="flex items-center gap-3">
        <span class="text-sm">{m.trigger_form_every()}</span>
        <NumberField
          id="trigger-interval"
          class="w-24"
          bind:value={trigger.interval}
          {invalid}
          {describedby}
        />
        <span class="text-sm">{intervalUnit}</span>
      </div>
    {/snippet}
  </Field>

  {#if freq === "weekly"}
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium">{m.trigger_form_weekdays()}</span>
      <ChipGroup
        label={m.trigger_form_weekdays()}
        class={weekdayGrid}
        options={weekdayChips()}
        bind:selected={
          () => trigger.byWeekday ?? [],
          (value) => (trigger.byWeekday = value.length > 0 ? value : undefined)
        }
      />
      {#if errors.byWeekday}
        <p class="text-destructive text-xs">{errors.byWeekday}</p>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium">{m.trigger_form_day_mode()}</span>
      <Segmented
        label={m.trigger_form_day_mode()}
        options={[
          { value: "day", label: m.trigger_day_mode_day() },
          { value: "nth", label: m.trigger_day_mode_nth() },
        ]}
        value={dayMode}
        onchange={setDayMode}
      />
    </div>
    {#if dayMode === "day"}
      <Field
        id="trigger-monthday"
        label={m.trigger_form_monthday()}
        error={errors.byMonthDay}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="trigger-monthday"
            value={String(trigger.byMonthDay ?? "")}
            options={dayOptions}
            {invalid}
            {describedby}
            onchange={(v) => (trigger.byMonthDay = Number(v))}
          />
        {/snippet}
      </Field>
    {:else}
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field id="trigger-nth" label={m.trigger_form_nth()} error={errors.nth}>
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="trigger-nth"
              value={String(trigger.nth ?? "")}
              options={nthOptions}
              {invalid}
              {describedby}
              onchange={(v) => (trigger.nth = Number(v))}
            />
          {/snippet}
        </Field>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium">{m.trigger_form_weekday()}</span>
          <ChipGroup
            single
            label={m.trigger_form_weekday()}
            class={weekdayGrid}
            options={weekdayChips()}
            bind:selected={
              () => trigger.byWeekday ?? [],
              (value) => (trigger.byWeekday = value)
            }
          />
          {#if errors.byWeekday}
            <p class="text-destructive text-xs">{errors.byWeekday}</p>
          {/if}
        </div>
      </div>
    {/if}
    {#if freq === "monthly" || freq === "yearly"}
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">
          {freq === "yearly"
            ? m.trigger_form_months_year()
            : m.trigger_form_months_only()}
        </span>
        <ChipGroup
          label={m.trigger_form_months_only()}
          class={monthGrid}
          options={monthChips()}
          bind:selected={
            () => trigger.byMonth ?? [],
            (value) => (trigger.byMonth = value.length > 0 ? value : undefined)
          }
        />
        <p class="text-muted-foreground text-xs">
          {freq === "yearly"
            ? m.trigger_form_months_year_hint()
            : m.trigger_form_months_only_hint()}
        </p>
        {#if errors.byMonth}
          <p class="text-destructive text-xs">{errors.byMonth}</p>
        {/if}
      </div>
    {/if}
  {/if}

  <Field
    id="trigger-start"
    label={m.trigger_form_start_calendar()}
    hint={m.trigger_form_start_calendar_hint()}
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
</div>
