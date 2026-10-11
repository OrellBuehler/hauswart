<script lang="ts">
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import {
    APPOINTMENT_LOCATION_MAX,
    APPOINTMENT_NOTES_MAX,
    APPOINTMENT_TITLE_MAX,
    type Appointment,
  } from "$lib/api/schemas/appointments";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import ContactSelect from "$lib/components/contacts/contact-select.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { formatWhen } from "$lib/appointments/format";
  import {
    buildCreateBody,
    buildUpdateBody,
    draftFromAppointment,
    draftWhen,
    fieldsOfWhen,
    mapFieldErrors,
    newDraft,
    type AppointmentDefaults,
    type AppointmentDraft,
  } from "$lib/appointments/form";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import LinkSelect from "./link-select.svelte";

  let {
    open = $bindable(false),
    appointment,
    timeZone,
    today,
    defaults = {},
    onsaved,
  }: {
    open?: boolean;
    /** The appointment to edit; undefined adds a new one. */
    appointment?: Appointment | undefined;
    /** The household's time zone: times in the form are wall-clock times there. */
    timeZone: string;
    today: string;
    /** What a new appointment starts with, e.g. the task it is for. */
    defaults?: AppointmentDefaults;
    onsaved: (saved: Appointment) => void | Promise<void>;
  } = $props();

  type Choice = { value: string; label: string; detail: string | null };

  let draft = $state<AppointmentDraft>(
    untrack(() => newDraft({ today, ...defaults })),
  );
  let errors = $state<Record<string, string>>({});
  /** The end date field is shown: the appointment ends on another day than it starts. */
  let showEndDate = $state(false);

  let tasks = $state.raw<(Choice & { assetId: string | null })[]>([]);
  let assets = $state.raw<Choice[]>([]);
  let loadingRefs = $state(false);
  let refsError = $state<string | undefined>();
  let loadTicket = 0;

  const editing = $derived(appointment !== undefined);
  const preview = $derived(draftWhen(draft, timeZone));
  const previewText = $derived(
    preview.when
      ? formatWhen(fieldsOfWhen(preview.when), { timeZone, today })
      : null,
  );
  /** Why there is no preview yet: what is still missing, else what is wrong with the end. */
  const previewHint = $derived.by(() => {
    if (preview.when) return null;
    if (preview.errors.startDate || preview.errors.startTime) {
      return draft.allDay
        ? m.appointment_preview_missing_day()
        : m.appointment_preview_missing();
    }
    return Object.values(preview.errors)[0] ?? null;
  });
  const taskLabel = $derived(appointment?.taskTitle ?? defaults.taskTitle);
  const assetLabel = $derived(appointment?.assetName ?? defaults.assetName);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      draft = appointment
        ? draftFromAppointment(appointment, timeZone)
        : newDraft({ today, ...defaults });
      showEndDate = !draft.allDay && draft.endDate !== "";
      errors = {};
      void loadRefs();
    });
  });

  async function loadRefs() {
    const ticket = ++loadTicket;
    loadingRefs = true;
    refsError = undefined;
    try {
      const [taskList, assetList] = await Promise.all([
        fetchAll((cursor) =>
          api.call(endpoints.tasksList, { query: { cursor, limit: 200 } }),
        ),
        fetchAll((cursor) =>
          api.call(endpoints.assetsList, { query: { cursor, limit: 200 } }),
        ),
      ]);
      if (ticket !== loadTicket) return;
      tasks = taskList
        .map((task) => ({
          value: task.id,
          label: task.title,
          detail: task.assetName ?? task.roomName,
          assetId: task.assetId,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      assets = assetList
        .map((asset) => ({
          value: asset.id,
          label: asset.name,
          detail: asset.roomName,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (err) {
      if (ticket === loadTicket) refsError = apiErrorMessage(err);
    } finally {
      if (ticket === loadTicket) loadingRefs = false;
    }
  }

  /** A task brings its title and its device along when the form has none yet. */
  function taskChosen(id: string | null) {
    draft.occurrenceKey =
      id !== null && id === defaults.taskId
        ? (defaults.occurrenceKey ?? null)
        : null;
    const task = tasks.find((candidate) => candidate.value === id);
    if (!task) return;
    if (!draft.title.trim()) draft.title = task.label;
    if (!draft.assetId && task.assetId) draft.assetId = task.assetId;
  }

  function toggleEndDate() {
    if (showEndDate) draft.endDate = "";
    showEndDate = !showEndDate;
  }

  function switchKind(allDay: boolean) {
    // Each kind keeps its own end: a time of day means nothing to a whole day and the other way round.
    if (allDay) showEndDate = false;
    else showEndDate = draft.endDate !== "";
  }

  async function submit(): Promise<string | void> {
    try {
      if (appointment) {
        const built = buildUpdateBody(draft, appointment, timeZone);
        errors = built.errors;
        if (!built.body) return m.form_check_fields();
        if (Object.keys(built.body).length === 0) {
          toast.info(m.appointment_form_no_changes());
          return;
        }
        const saved = await api.call(endpoints.appointmentsUpdate, {
          params: { id: appointment.id },
          body: built.body,
        });
        toast.success(m.appointment_saved_toast({ title: saved.title }));
        await onsaved(saved);
      } else {
        const built = buildCreateBody(draft, timeZone);
        errors = built.errors;
        if (!built.body) return m.form_check_fields();
        const saved = await api.call(endpoints.appointmentsCreate, {
          body: built.body,
        });
        toast.success(m.appointment_created_toast({ title: saved.title }));
        await onsaved(saved);
      }
    } catch (err) {
      errors = mapFieldErrors(apiFieldErrors(err));
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.appointment_edit_title() : m.appointment_create_title()}
  description={editing
    ? m.appointment_edit_description()
    : m.appointment_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <Field
    id="appointment-title"
    label={m.appointment_title_label()}
    error={errors.title}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="appointment-title"
        class="h-10"
        autocomplete="off"
        maxlength={APPOINTMENT_TITLE_MAX}
        placeholder={m.appointment_title_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.title}
      />
    {/snippet}
  </Field>

  <SwitchField
    id="appointment-all-day"
    bind:checked={draft.allDay}
    label={m.appointment_all_day_label()}
    hint={m.appointment_all_day_hint()}
    onchange={switchKind}
  />

  {#if draft.allDay}
    <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field
        id="appointment-start-date"
        label={m.appointment_from_label()}
        error={errors.startDate}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="appointment-start-date"
            type="date"
            class="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.startDate}
          />
        {/snippet}
      </Field>
      <Field
        id="appointment-end-date"
        label={m.appointment_to_label()}
        optional
        hint={m.appointment_to_hint()}
        error={errors.endDate}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="appointment-end-date"
            type="date"
            class="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.endDate}
          />
        {/snippet}
      </Field>
    </div>
  {:else}
    <Field
      id="appointment-start-date"
      label={m.appointment_date_label()}
      error={errors.startDate}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="appointment-start-date"
          type="date"
          class="h-10"
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.startDate}
        />
      {/snippet}
    </Field>
    <div class="grid grid-cols-2 gap-4">
      <Field
        id="appointment-start-time"
        label={m.appointment_start_time_label()}
        error={errors.startTime}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="appointment-start-time"
            type="time"
            class="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.startTime}
          />
        {/snippet}
      </Field>
      <Field
        id="appointment-end-time"
        label={m.appointment_end_time_label()}
        optional
        error={errors.endTime}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="appointment-end-time"
            type="time"
            class="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.endTime}
          />
        {/snippet}
      </Field>
    </div>
    {#if showEndDate}
      <Field
        id="appointment-end-date"
        label={m.appointment_end_date_label()}
        error={errors.endDate}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="appointment-end-date"
            type="date"
            class="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.endDate}
          />
        {/snippet}
      </Field>
    {/if}
    <div class="-mt-2 flex flex-col items-start gap-1">
      <p class="text-muted-foreground text-xs text-pretty">
        {m.appointment_end_time_hint()}
      </p>
      <Button
        type="button"
        variant="link"
        class="text-brand h-auto min-h-10 p-0 text-sm font-medium underline underline-offset-4"
        aria-expanded={showEndDate}
        onclick={toggleEndDate}
      >
        {showEndDate
          ? m.appointment_end_same_day()
          : m.appointment_end_other_day()}
      </Button>
    </div>
  {/if}

  <div
    class="bg-muted/40 flex items-start gap-3 rounded-lg border p-3"
    aria-live="polite"
  >
    <CalendarClockIcon
      class="text-muted-foreground mt-0.5 size-5 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-col gap-0.5 text-sm">
      <p class="font-medium">{m.appointment_preview_title()}</p>
      <p class="text-muted-foreground wrap-anywhere tabular-nums">
        {previewText ?? previewHint}
      </p>
    </div>
  </div>

  <Field
    id="appointment-location"
    label={m.appointment_location_label()}
    optional
    error={errors.location}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="appointment-location"
        class="h-10"
        autocomplete="off"
        maxlength={APPOINTMENT_LOCATION_MAX}
        placeholder={m.appointment_location_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.location}
      />
    {/snippet}
  </Field>

  <Field
    id="appointment-task"
    label={m.appointment_task_label()}
    optional
    hint={m.appointment_task_hint()}
    error={errors.taskId}
  >
    {#snippet children({ describedby, invalid })}
      <LinkSelect
        id="appointment-task"
        bind:value={draft.taskId}
        items={tasks}
        noneLabel={m.appointment_task_none()}
        fallbackLabel={taskLabel ?? null}
        loading={loadingRefs}
        {invalid}
        {describedby}
        onchange={taskChosen}
      />
    {/snippet}
  </Field>

  <Field
    id="appointment-asset"
    label={m.appointment_asset_label()}
    optional
    error={errors.assetId}
  >
    {#snippet children({ describedby, invalid })}
      <LinkSelect
        id="appointment-asset"
        bind:value={draft.assetId}
        items={assets}
        noneLabel={m.appointment_asset_none()}
        fallbackLabel={assetLabel ?? null}
        loading={loadingRefs}
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>

  <Field
    id="appointment-contact"
    label={m.appointment_contact_label()}
    optional
    error={errors.contactId}
  >
    <ContactSelect id="appointment-contact" bind:value={draft.contactId} />
  </Field>

  {#if refsError}
    <p
      class="text-destructive -mt-3 flex flex-wrap items-center gap-x-2 text-xs"
    >
      <span>{refsError}</span>
      <Button
        type="button"
        variant="link"
        class="h-auto min-h-10 p-0 text-xs"
        onclick={() => void loadRefs()}
      >
        {m.common_retry()}
      </Button>
    </p>
  {/if}

  <Field
    id="appointment-notes"
    label={m.appointment_notes_label()}
    optional
    hint={m.appointment_notes_hint()}
    error={errors.notes}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="appointment-notes"
        rows={3}
        maxlength={APPOINTMENT_NOTES_MAX}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.notes}
      />
    {/snippet}
  </Field>
</FormDialog>
