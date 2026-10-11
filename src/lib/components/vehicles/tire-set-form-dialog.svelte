<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { TIRE_SEASONS, type TireSeason } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { TireSet } from "$lib/api/schemas/tire-sets";
  import type { Vehicle } from "$lib/api/schemas/vehicles";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import ContactSelect from "$lib/components/contacts/contact-select.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { tireSeasonOptionLabels } from "$lib/vehicles/labels";
  import {
    buildCreateTireSet,
    buildUpdateTireSet,
    draftFromTireSet,
    newTireSetDraft,
    type TireSetDraft,
  } from "$lib/vehicles/tire-form";

  let {
    open = $bindable(false),
    assetId,
    set,
    vehicle,
    today,
    onsaved,
  }: {
    open?: boolean;
    assetId: string;
    set?: TireSet | undefined;
    vehicle: Pick<Vehicle, "tireSizeSummer" | "tireSizeWinter">;
    today: string;
    onsaved: () => void | Promise<void>;
  } = $props();

  const sizes = $derived<Record<TireSeason, string>>({
    summer: vehicle.tireSizeSummer ?? "",
    winter: vehicle.tireSizeWinter ?? "",
    all_season: vehicle.tireSizeSummer ?? vehicle.tireSizeWinter ?? "",
  });

  let draft = $state<TireSetDraft>(
    untrack(() => newTireSetDraft({ season: "winter", today })),
  );
  let sizeTouched = $state(false);
  let errors = $state<Record<string, string>>({});

  const editing = $derived(set !== undefined);
  const seasonOptions = TIRE_SEASONS.map((value) => ({
    value,
    label: tireSeasonOptionLabels[value](),
  }));

  $effect(() => {
    if (!open) return;
    draft = set
      ? draftFromTireSet(set)
      : newTireSetDraft({ season: "winter", today, size: sizes.winter });
    sizeTouched = false;
    errors = {};
  });

  function chooseSeason(season: TireSeason) {
    if (!editing && !sizeTouched) draft.size = sizes[season];
  }

  async function save(
    call: () => Promise<unknown>,
    saved: string,
  ): Promise<string | void> {
    try {
      await call();
      toast.success(saved);
      await onsaved();
    } catch (err) {
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }

  async function submit(): Promise<string | void> {
    if (set) {
      const { id } = set;
      const built = buildUpdateTireSet(draft);
      errors = built.errors;
      const body = built.body;
      if (!body) return m.form_check_fields();
      return save(
        () => api.call(endpoints.tireSetsUpdate, { params: { id }, body }),
        m.tire_saved_toast(),
      );
    }
    const built = buildCreateTireSet(draft, today);
    errors = built.errors;
    const body = built.body;
    if (!body) return m.form_check_fields();
    return save(
      () =>
        api.call(endpoints.tireSetsCreate, { params: { id: assetId }, body }),
      m.tire_created_toast(),
    );
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.tire_form_edit_title() : m.tire_form_create_title()}
  description={m.tire_form_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.tire_season()}</span>
    <Segmented
      label={m.tire_season()}
      options={seasonOptions}
      bind:value={draft.season}
      onchange={chooseSeason}
    />
    {#if errors.season}
      <p class="text-destructive text-xs">{errors.season}</p>
    {/if}
  </div>
  <div class="grid gap-5 sm:grid-cols-2">
    <Field id="tire-brand" label={m.tire_brand()} optional error={errors.brand}>
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-brand"
          class="h-10"
          autocomplete="off"
          maxlength={80}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.brand}
        />
      {/snippet}
    </Field>
    <Field id="tire-model" label={m.tire_model()} optional error={errors.model}>
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-model"
          class="h-10"
          autocomplete="off"
          maxlength={80}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.model}
        />
      {/snippet}
    </Field>
    <Field id="tire-size" label={m.tire_size()} optional error={errors.size}>
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-size"
          class="h-10"
          autocomplete="off"
          spellcheck={false}
          maxlength={40}
          placeholder={m.vehicle_tire_placeholder()}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          oninput={() => (sizeTouched = true)}
          bind:value={draft.size}
        />
      {/snippet}
    </Field>
    <Field
      id="tire-dot"
      label={m.tire_dot()}
      optional
      hint={m.tire_dot_hint()}
      error={errors.dot}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-dot"
          class="h-10 tabular-nums"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          maxlength={4}
          placeholder={m.tire_dot_placeholder()}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.dot}
        />
      {/snippet}
    </Field>
  </div>
  {#if !editing}
    <div class="grid gap-5 sm:grid-cols-2">
      <Field
        id="tire-tread"
        label={m.tire_tread_first()}
        optional
        hint={m.tire_tread_first_hint()}
        error={errors.treadDepthMm}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="tire-tread"
            class="h-10 tabular-nums"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.treadDepth}
          />
        {/snippet}
      </Field>
      {#if draft.treadDepth.trim() !== ""}
        <Field
          id="tire-tread-date"
          label={m.tire_tread_date()}
          error={errors.treadMeasuredOn}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="tire-tread-date"
              class="h-10"
              type="date"
              max={today}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.treadMeasuredOn}
            />
          {/snippet}
        </Field>
      {/if}
    </div>
  {/if}
  <div class="grid gap-5 sm:grid-cols-2">
    <Field
      id="tire-storage"
      label={m.tire_storage()}
      optional
      error={errors.storageLocation}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-storage"
          class="h-10"
          autocomplete="off"
          maxlength={200}
          placeholder={m.tire_storage_placeholder()}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.storageLocation}
        />
      {/snippet}
    </Field>
    <Field
      id="tire-storage-contact"
      label={m.tire_storage_contact()}
      optional
      error={errors.storageContactId}
    >
      <ContactSelect
        id="tire-storage-contact"
        bind:value={draft.storageContactId}
      />
    </Field>
    <Field
      id="tire-purchased"
      label={m.tire_purchased()}
      optional
      error={errors.purchasedOn}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="tire-purchased"
          class="h-10"
          type="date"
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.purchasedOn}
        />
      {/snippet}
    </Field>
  </div>
  <Field id="tire-notes" label={m.tire_notes()} optional error={errors.notes}>
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="tire-notes"
        rows={3}
        maxlength={5000}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.notes}
      />
    {/snippet}
  </Field>
</FormDialog>
