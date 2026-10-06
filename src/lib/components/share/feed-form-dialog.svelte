<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    USER_LOCALES,
    type FeedScope,
    type UserLocale,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import {
    FEED_NAME_MAX,
    MAX_ALARM_DAYS_BEFORE,
    type CalendarFeed,
  } from "$lib/api/schemas/share";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let {
    open = $bindable(false),
    feed,
    onsaved,
  }: {
    open?: boolean;
    /** The feed to edit; undefined creates a new one. */
    feed?: CalendarFeed | undefined;
    onsaved: (feed: CalendarFeed, created: boolean) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let scope = $state<FeedScope>("mine");
  let includeEstimated = $state(false);
  let includePreparations = $state(true);
  let includeDefects = $state(true);
  let includeWarranties = $state(true);
  let alarmOn = $state(false);
  let alarmTime = $state("08:00");
  let alarmDays = $state<number | undefined>(1);
  let locale = $state<string>("de");
  let fieldErrors = $state<Record<string, string>>({});

  const editing = $derived(feed !== undefined);
  const scopeOptions = $derived([
    { value: "mine" as const, label: m.feeds_scope_mine() },
    { value: "all" as const, label: m.feeds_scope_all() },
  ]);
  const localeOptions = $derived(
    USER_LOCALES.map((value) => ({
      value,
      label: value === "de" ? m.locale_name_de() : m.locale_name_en(),
    })),
  );

  $effect(() => {
    if (!open) return;
    name = feed?.name ?? "";
    scope = feed?.scope ?? "mine";
    includeEstimated = feed?.includeEstimated ?? false;
    includePreparations = feed?.includePreparations ?? true;
    includeDefects = feed?.includeDefects ?? true;
    includeWarranties = feed?.includeWarranties ?? true;
    alarmOn = feed ? feed.alarmTime !== null : false;
    alarmTime = feed?.alarmTime ?? "08:00";
    alarmDays = feed ? feed.alarmDaysBefore : 1;
    locale = feed?.locale ?? getLocale();
    fieldErrors = {};
  });

  async function submit(): Promise<string | void> {
    fieldErrors = {};
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = m.field_required();
    if (alarmOn) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(alarmTime))
        errors.alarmTime = m.field_required();
      if (
        alarmDays === undefined ||
        !Number.isInteger(alarmDays) ||
        alarmDays < 0 ||
        alarmDays > MAX_ALARM_DAYS_BEFORE
      )
        errors.alarmDaysBefore = m.feeds_alarm_days_range({
          max: MAX_ALARM_DAYS_BEFORE,
        });
    }
    if (Object.keys(errors).length > 0) {
      fieldErrors = errors;
      return m.form_check_fields();
    }
    const body = {
      name: name.trim(),
      scope,
      includeEstimated,
      includePreparations,
      includeDefects,
      includeWarranties,
      alarmTime: alarmOn ? alarmTime : null,
      alarmDaysBefore: alarmOn
        ? (alarmDays ?? 0)
        : (feed?.alarmDaysBefore ?? 0),
      locale: locale as UserLocale,
    };
    try {
      const saved = feed
        ? await api.call(endpoints.calendarFeedsUpdate, {
            params: { id: feed.id },
            body,
          })
        : await api.call(endpoints.calendarFeedsCreate, { body });
      toast.success(
        editing
          ? m.feeds_saved_toast({ name: saved.name })
          : m.feeds_created_toast({ name: saved.name }),
      );
      await onsaved(saved, !editing);
    } catch (err) {
      fieldErrors = apiFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err, { conflict: m.feeds_limit_reached() });
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.feeds_edit_title() : m.feeds_create_title()}
  description={editing
    ? m.feeds_edit_description()
    : m.feeds_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <Field id="feed-name" label={m.feeds_name()} error={fieldErrors.name}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="feed-name"
        autocomplete="off"
        maxlength={FEED_NAME_MAX}
        placeholder={m.feeds_name_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={name}
      />
    {/snippet}
  </Field>

  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">
      {m.feeds_scope()}
    </span>
    <Segmented
      options={scopeOptions}
      bind:value={scope}
      label={m.feeds_scope()}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {scope === "mine" ? m.feeds_scope_mine_hint() : m.feeds_scope_all_hint()}
    </p>
  </div>

  <fieldset class="flex flex-col gap-4">
    <legend class="mb-3 text-sm font-medium">{m.feeds_content()}</legend>
    <SwitchField
      id="feed-preparations"
      bind:checked={includePreparations}
      label={m.feeds_include_preparations()}
      hint={m.feeds_include_preparations_hint()}
    />
    <SwitchField
      id="feed-defects"
      bind:checked={includeDefects}
      label={m.feeds_include_defects()}
      hint={m.feeds_include_defects_hint()}
    />
    <SwitchField
      id="feed-warranties"
      bind:checked={includeWarranties}
      label={m.feeds_include_warranties()}
      hint={m.feeds_include_warranties_hint()}
    />
    <SwitchField
      id="feed-estimated"
      bind:checked={includeEstimated}
      label={m.feeds_include_estimated()}
      hint={m.feeds_include_estimated_hint()}
    />
  </fieldset>

  <fieldset class="flex flex-col gap-4">
    <legend class="mb-3 text-sm font-medium">{m.feeds_alarm_title()}</legend>
    <SwitchField
      id="feed-alarm"
      bind:checked={alarmOn}
      label={m.feeds_alarm_enable()}
      hint={m.feeds_alarm_enable_hint()}
    />
    {#if alarmOn}
      <div class="grid gap-4 ps-0 sm:grid-cols-2">
        <Field
          id="feed-alarm-time"
          label={m.feeds_alarm_time()}
          error={fieldErrors.alarmTime}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="feed-alarm-time"
              type="time"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              class="h-10"
              bind:value={alarmTime}
            />
          {/snippet}
        </Field>
        <Field
          id="feed-alarm-days"
          label={m.feeds_alarm_days()}
          hint={m.feeds_alarm_days_hint()}
          error={fieldErrors.alarmDaysBefore}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="feed-alarm-days"
              bind:value={alarmDays}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>
    {/if}
  </fieldset>

  <Field id="feed-locale" label={m.feeds_locale()} hint={m.feeds_locale_hint()}>
    {#snippet children({ describedby })}
      <OptionSelect
        id="feed-locale"
        options={localeOptions}
        bind:value={locale}
        {describedby}
      />
    {/snippet}
  </Field>
</FormDialog>
