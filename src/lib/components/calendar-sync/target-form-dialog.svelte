<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    CALENDAR_ITEM_KINDS,
    CALENDAR_REMOTE_DELETE_POLICIES,
    CALENDAR_TIMED_MODES,
    FEED_SCOPES,
    INTEGRATION_LEVELS,
    USER_LOCALES,
    type CalendarItemKind,
    type CalendarProviderKind,
    type UserLocale,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import {
    MAX_TARGET_NAME,
    MAX_TITLE_PREFIX,
    type CalendarTarget,
  } from "$lib/api/schemas/calendar-sync";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    alarmsSupported,
    createBody,
    defaultDraft,
    draftFromTarget,
    orderedKinds,
    updateBody,
    validateDraft,
    type TargetDraft,
  } from "$lib/calendar-sync/form";
  import { saveFailure } from "$lib/calendar-sync/errors";
  import {
    calendarKindHints,
    calendarKindLabels,
    remoteDeleteHints,
    remoteDeleteLabels,
    timedModeLabels,
  } from "$lib/calendar-sync/labels";
  import { providerName } from "$lib/calendar-sync/providers";
  import type { ExternalCalendar } from "$lib/connections/types";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import CalendarPicker from "./calendar-picker.svelte";

  let {
    open = $bindable(false),
    target,
    providers,
    targets,
    onsaved,
  }: {
    open?: boolean;
    /** The target to edit; undefined adds a new one. */
    target?: CalendarTarget | undefined;
    /** The calendar systems the person can add a calendar of. */
    providers: CalendarProviderKind[];
    /** All targets the person sees, to tell which calendars are taken already. */
    targets: CalendarTarget[];
    onsaved: (target: CalendarTarget, created: boolean) => void | Promise<void>;
  } = $props();

  let draft = $state<TargetDraft>(defaultDraft("de"));
  let provider = $state<CalendarProviderKind>("homeassistant");
  let remoteCalendarId = $state("");
  let chosen = $state<ExternalCalendar | undefined>();
  let fieldErrors = $state<Record<string, string>>({});

  const editing = $derived(target !== undefined);
  const level = $derived(target ? target.level : INTEGRATION_LEVELS[provider]);
  const capabilities = $derived(
    target ? target.capabilities : (chosen?.capabilities ?? null),
  );
  const alarms = $derived(alarmsSupported(capabilities));
  const usedIds = $derived(
    targets
      .filter((t) => t.provider === provider)
      .map((t) => t.remoteCalendarId),
  );
  const providerOptions = $derived(
    providers.map((value) => ({ value, label: providerName(value) })),
  );
  const scopeOptions = $derived(
    FEED_SCOPES.map((value) => ({
      value,
      label:
        value === "mine" ? m.caltargets_scope_mine() : m.caltargets_scope_all(),
    })),
  );
  const timedOptions = $derived(
    CALENDAR_TIMED_MODES.map((value) => ({
      value,
      label: timedModeLabels[value](),
    })),
  );
  const deleteOptions = $derived(
    CALENDAR_REMOTE_DELETE_POLICIES.map((value) => ({
      value,
      label: remoteDeleteLabels[value](),
    })),
  );
  const localeOptions = $derived(
    USER_LOCALES.map((value) => ({
      value,
      label: value === "de" ? m.locale_name_de() : m.locale_name_en(),
    })),
  );

  $effect(() => {
    if (!open) return;
    // Only the opening resets the form: a refresh of the list behind it must not undo what was typed.
    untrack(() => {
      draft = target ? draftFromTarget(target) : defaultDraft(getLocale());
      provider = target?.provider ?? providers[0] ?? "homeassistant";
      remoteCalendarId = target?.remoteCalendarId ?? "";
      chosen = undefined;
      fieldErrors = {};
    });
  });

  function providerChanged() {
    // A calendar of another system is not a choice here.
    remoteCalendarId = "";
    chosen = undefined;
  }

  function toggleKind(kind: CalendarItemKind, on: boolean) {
    draft.kinds = orderedKinds(
      on
        ? [...draft.kinds.filter((k) => k !== kind), kind]
        : draft.kinds.filter((k) => k !== kind),
    );
  }

  async function submit(): Promise<string | void> {
    fieldErrors = {};
    const errors = validateDraft(draft, {
      creating: !editing,
      remoteCalendarId,
      level,
      capabilities,
    });
    if (Object.keys(errors).length > 0) {
      fieldErrors = errors;
      return m.form_check_fields();
    }
    try {
      if (target) {
        const body = updateBody(target, draft, { capabilities });
        if (body === null) return;
        const saved = await api.call(endpoints.calendarTargetsUpdate, {
          params: { id: target.id },
          body,
        });
        toast.success(m.caltargets_saved_toast({ name: saved.name }));
        await onsaved(saved, false);
        return;
      }
      const saved = await api.call(endpoints.calendarTargetsCreate, {
        body: createBody(provider, remoteCalendarId, draft, {
          level,
          capabilities,
        }),
      });
      toast.success(m.caltargets_created_toast({ name: saved.name }));
      await onsaved(saved, true);
    } catch (err) {
      const failure = saveFailure(err, target?.provider ?? provider);
      fieldErrors = failure.fields;
      return failure.form ?? m.form_check_fields();
    }
  }
</script>

<FormDialog
  bind:open
  class="sm:max-w-xl"
  title={editing ? m.caltargets_edit_title() : m.caltargets_create_title()}
  description={editing
    ? m.caltargets_edit_description()
    : m.caltargets_create_description()}
  submitLabel={editing ? m.common_save() : m.common_add()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <p class="text-muted-foreground flex items-start gap-2 text-sm text-pretty">
    <ArrowRightIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <span>{m.caltargets_direction_note()}</span>
  </p>

  {#if !editing && providers.length > 1}
    <div class="flex flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.caltargets_provider()}</span
      >
      <Segmented
        options={providerOptions}
        bind:value={provider}
        label={m.caltargets_provider()}
        onchange={providerChanged}
      />
    </div>
  {/if}

  {#if editing && target}
    <div class="flex flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.caltargets_calendar()}</span
      >
      <div
        class="bg-muted/50 flex flex-col gap-0.5 rounded-lg border px-3 py-2"
      >
        <span class="text-sm font-medium">{providerName(target.provider)}</span>
        {#if target.remoteName}
          <span class="text-sm break-words">{target.remoteName}</span>
        {/if}
        <span class="text-muted-foreground font-mono text-xs break-all"
          >{target.remoteCalendarId}</span
        >
      </div>
      <p class="text-muted-foreground text-xs text-pretty">
        {m.caltargets_calendar_fixed()}
      </p>
    </div>
  {:else}
    <Field
      id="caltarget-calendar"
      label={m.caltargets_calendar()}
      hint={m.caltargets_calendar_hint()}
      error={fieldErrors.remoteCalendarId}
    >
      {#snippet children({ describedby, invalid })}
        <CalendarPicker
          id="caltarget-calendar"
          {provider}
          bind:value={remoteCalendarId}
          bind:chosen
          {usedIds}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  {/if}

  <Field
    id="caltarget-name"
    label={m.caltargets_name()}
    hint={m.caltargets_name_hint()}
    error={fieldErrors.name}
    optional={!editing}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="caltarget-name"
        autocomplete="off"
        maxlength={MAX_TARGET_NAME}
        placeholder={chosen?.name ?? m.caltargets_name_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={draft.name}
      />
    {/snippet}
  </Field>

  <fieldset class="flex min-w-0 flex-col gap-1">
    <legend class="mb-2 text-sm font-medium">{m.caltargets_kinds()}</legend>
    {#each CALENDAR_ITEM_KINDS as kind (kind)}
      <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
        <Checkbox
          id={`caltarget-kind-${kind}`}
          class="mt-0.5"
          checked={draft.kinds.includes(kind)}
          onCheckedChange={(on) => toggleKind(kind, on)}
        />
        <span
          class="flex min-w-0 flex-col items-start gap-0.5 text-sm leading-snug font-medium"
        >
          <span>{calendarKindLabels[kind]()}</span>
          <span class="text-muted-foreground text-xs font-normal text-pretty">
            {calendarKindHints[kind]()}
          </span>
        </span>
      </label>
    {/each}
    {#if fieldErrors.kinds}
      <p class="text-destructive text-xs text-pretty" role="alert">
        {fieldErrors.kinds}
      </p>
    {/if}
  </fieldset>

  {#if level === "user"}
    <div class="flex flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.caltargets_scope()}</span
      >
      <Segmented
        options={scopeOptions}
        bind:value={draft.scope}
        label={m.caltargets_scope()}
      />
      <p class="text-muted-foreground text-xs text-pretty">
        {draft.scope === "mine"
          ? m.caltargets_scope_mine_hint()
          : m.caltargets_scope_all_hint()}
      </p>
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.caltargets_timing()}</span
    >
    <Segmented
      options={timedOptions}
      bind:value={draft.timedMode}
      label={m.caltargets_timing()}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {draft.timedMode === "timed"
        ? m.caltargets_timing_hint_timed()
        : m.caltargets_timing_hint_all_day()}
    </p>
    {#if draft.timedMode === "timed"}
      <div class="mt-1 grid gap-4 sm:grid-cols-2">
        <Field
          id="caltarget-due-time"
          label={m.caltargets_due_time()}
          error={fieldErrors.dueTime}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="caltarget-due-time"
              type="time"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              class="h-10"
              bind:value={draft.dueTime}
            />
          {/snippet}
        </Field>
        <Field
          id="caltarget-due-duration"
          label={m.caltargets_due_duration()}
          error={fieldErrors.dueDurationMinutes}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="caltarget-due-duration"
              bind:value={draft.dueDurationMinutes}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>
    {/if}
  </div>

  <fieldset class="flex flex-col gap-4">
    <legend class="mb-3 text-sm font-medium">{m.caltargets_alarm()}</legend>
    <SwitchField
      id="caltarget-alarm"
      bind:checked={
        () => draft.alarmOn && alarms, (value) => (draft.alarmOn = value)
      }
      disabled={!alarms}
      label={m.caltargets_alarm_enable()}
      hint={alarms
        ? m.caltargets_alarm_enable_hint()
        : m.caltargets_alarm_unsupported({
            provider: providerName(target?.provider ?? provider),
          })}
    />
    {#if draft.alarmOn && alarms}
      <Field
        id="caltarget-alarm-minutes"
        label={m.caltargets_alarm_minutes()}
        error={fieldErrors.alarmMinutes}
      >
        {#snippet children({ describedby, invalid })}
          <NumberField
            id="caltarget-alarm-minutes"
            bind:value={draft.alarmMinutes}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    {/if}
  </fieldset>

  <Field
    id="caltarget-prefix"
    label={m.caltargets_title_prefix()}
    hint={m.caltargets_title_prefix_hint()}
    error={fieldErrors.titlePrefix}
    optional
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="caltarget-prefix"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        maxlength={MAX_TITLE_PREFIX}
        placeholder="hauswart: "
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={draft.titlePrefix}
      />
    {/snippet}
  </Field>

  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium"
      >{m.caltargets_remote_delete()}</span
    >
    <Segmented
      options={deleteOptions}
      bind:value={draft.onRemoteDelete}
      label={m.caltargets_remote_delete()}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {remoteDeleteHints[draft.onRemoteDelete]()}
    </p>
  </div>

  <Field
    id="caltarget-locale"
    label={m.caltargets_locale()}
    hint={m.caltargets_locale_hint()}
  >
    {#snippet children({ describedby })}
      <OptionSelect
        id="caltarget-locale"
        options={localeOptions}
        bind:value={
          () => draft.locale, (value) => (draft.locale = value as UserLocale)
        }
        {describedby}
      />
    {/snippet}
  </Field>
</FormDialog>
