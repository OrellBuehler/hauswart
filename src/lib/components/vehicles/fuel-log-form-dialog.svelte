<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    FUEL_UNITS,
    type OdometerUnit,
    type VehicleFuelType,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { FuelLog } from "$lib/api/schemas/fuel-logs";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import type { OdometerSummary } from "$lib/api/schemas/vehicles";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import SplitEditor from "$lib/components/costs/split-editor.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { resolve } from "$app/paths";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { readMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import {
    buildCreateFuelLog,
    buildUpdateFuelLog,
    defaultFuelUnit,
    draftFromFuelLog,
    newFuelDraft,
    type FuelDraft,
  } from "$lib/vehicles/fuel-form";
  import { formatOdometer } from "$lib/vehicles/format";
  import { fuelUnitLabels } from "$lib/vehicles/labels";
  import { refusedMessage, refusedReading } from "$lib/vehicles/odometer-error";

  let {
    open = $bindable(false),
    assetId,
    log,
    fuelType,
    odometerUnit,
    latest,
    currency,
    today,
    people,
    currentUserId,
    onsaved,
  }: {
    open?: boolean;
    assetId: string;
    log?: FuelLog | undefined;
    fuelType: VehicleFuelType | null;
    odometerUnit: OdometerUnit;
    latest: OdometerSummary | null;
    currency: string;
    today: string;
    people: DirectoryUser[];
    currentUserId: string;
    onsaved: () => void | Promise<void>;
  } = $props();

  const userIds = $derived(people.map((p) => p.id));

  let draft = $state<FuelDraft>(
    untrack(() =>
      newFuelDraft({
        today,
        unit: "l",
        currency,
        paidByUserId: "",
        userIds: [],
      }),
    ),
  );
  let errors = $state<Record<string, string>>({});
  let moreOpen = $state(false);

  const editing = $derived(log !== undefined);
  const unitOptions = FUEL_UNITS.map((value) => ({
    value,
    label: fuelUnitLabels[value](),
  }));
  const payerOptions = $derived([
    { value: "", label: m.cost_payer_none() },
    ...people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);
  const amountMinor = $derived.by(() => {
    const value = readMoney(draft.amount, draft.currency);
    return typeof value === "number" && value > 0 ? value : undefined;
  });
  const MORE_FIELDS = [
    "currency",
    "shares",
    "paidByUserId",
    "station",
    "notes",
    "unit",
    "splitMode",
  ];

  $effect(() => {
    if (!open) return;
    untrack(() => {
      draft = log
        ? draftFromFuelLog(log, userIds)
        : newFuelDraft({
            today,
            unit: defaultFuelUnit(fuelType),
            currency,
            paidByUserId: people.some((p) => p.id === currentUserId)
              ? currentUserId
              : "",
            userIds,
          });
      errors = {};
      moreOpen = Boolean(
        log && (log.station || log.notes || log.missedPrevious),
      );
    });
  });

  function next(id: string) {
    return (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.getElementById(id)?.focus();
    };
  }

  function show(found: Record<string, string>) {
    errors = found;
    if (Object.keys(found).some((key) => MORE_FIELDS.includes(key))) {
      moreOpen = true;
    }
  }

  async function submit(): Promise<string | void> {
    let call: (() => Promise<unknown>) | undefined;
    if (log) {
      const { id } = log;
      const built = buildUpdateFuelLog(draft, log, today);
      if (built.kind === "invalid") {
        show(built.errors);
        return m.form_check_fields();
      }
      if (built.kind === "unchanged") return;
      const body = built.body;
      call = () => api.call(endpoints.fuelLogsUpdate, { params: { id }, body });
    } else {
      const built = buildCreateFuelLog(draft, { today, userIds });
      show(built.errors);
      const body = built.body;
      if (!body) return m.form_check_fields();
      call = () =>
        api.call(endpoints.fuelLogsCreate, { params: { id: assetId }, body });
    }
    try {
      await call();
      toast.success(editing ? m.fuel_saved_toast() : m.fuel_created_toast());
      await onsaved();
    } catch (err) {
      const refused = refusedReading(err, "odometer");
      if (refused) {
        errors = { odometer: refusedMessage(refused, odometerUnit) };
        return m.form_check_fields();
      }
      show(apiFieldErrors(err));
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.fuel_edit_title() : m.fuel_create_title()}
  description={m.fuel_form_description()}
  submitLabel={editing ? m.common_save() : m.fuel_save()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  <div class="grid grid-cols-2 gap-4">
    <Field
      id="fuel-amount"
      label={m.fuel_amount({ currency: draft.currency })}
      error={errors.amountMinor}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="fuel-amount"
          class="h-12 text-lg tabular-nums md:h-10 md:text-sm"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          enterkeyhint="next"
          placeholder="0.00"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          onkeydown={next("fuel-quantity")}
          bind:value={draft.amount}
        />
      {/snippet}
    </Field>
    <Field
      id="fuel-quantity"
      label={m.fuel_quantity({ unit: draft.unit })}
      error={errors.quantity}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="fuel-quantity"
          class="h-12 text-lg tabular-nums md:h-10 md:text-sm"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          enterkeyhint="next"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          onkeydown={next("fuel-odometer")}
          bind:value={draft.quantity}
        />
      {/snippet}
    </Field>
  </div>
  <Field
    id="fuel-odometer"
    label={m.vehicle_odometer_value({ unit: odometerUnit })}
    hint={latest
      ? m.vehicle_odometer_latest({
          value: formatOdometer(latest.value, latest.unit),
          date: formatDay(latest.date),
        })
      : m.vehicle_odometer_none_hint()}
    error={errors.odometer}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="fuel-odometer"
        class="h-12 text-lg tabular-nums md:h-10 md:text-sm"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        enterkeyhint="done"
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.odometer}
      />
    {/snippet}
  </Field>
  <SwitchField
    id="fuel-full"
    bind:checked={draft.fullTank}
    label={m.fuel_full_tank()}
    hint={m.fuel_full_tank_hint()}
  />
  <Field id="fuel-date" label={m.fuel_date()} error={errors.date}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="fuel-date"
        class="h-10"
        type="date"
        max={today}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.date}
      />
    {/snippet}
  </Field>

  <Collapsible.Root bind:open={moreOpen} class="flex flex-col gap-5">
    <Collapsible.Trigger
      type="button"
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-2 flex min-h-10 w-fit items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-[3px] [&[data-state=open]>svg]:rotate-180"
    >
      <ChevronDownIcon
        class="size-4 transition-transform motion-reduce:transition-none"
        aria-hidden="true"
      />
      {m.fuel_more()}
    </Collapsible.Trigger>
    <Collapsible.Content class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium">{m.fuel_unit()}</span>
        <Segmented
          label={m.fuel_unit()}
          options={unitOptions}
          bind:value={draft.unit}
        />
        {#if errors.unit}
          <p class="text-destructive text-xs">{errors.unit}</p>
        {/if}
      </div>
      <Field
        id="fuel-station"
        label={m.fuel_station()}
        optional
        error={errors.station}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="fuel-station"
            class="h-10"
            autocomplete="off"
            maxlength={120}
            placeholder={m.fuel_station_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.station}
          />
        {/snippet}
      </Field>
      <SwitchField
        id="fuel-missed"
        bind:checked={draft.missedPrevious}
        label={m.fuel_missed_previous()}
        hint={m.fuel_missed_previous_hint()}
      />
      <Field
        id="fuel-notes"
        label={m.fuel_notes()}
        optional
        error={errors.notes}
      >
        {#snippet children({ describedby, invalid })}
          <Textarea
            id="fuel-notes"
            rows={2}
            maxlength={2000}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.notes}
          />
        {/snippet}
      </Field>
      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="fuel-payer"
          label={m.cost_paid_by()}
          error={errors.paidByUserId}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="fuel-payer"
              bind:value={draft.paidByUserId}
              options={payerOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="fuel-currency"
          label={m.cost_currency()}
          error={errors.currency}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="fuel-currency"
              class="h-10 uppercase"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              maxlength={3}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.currency}
            />
          {/snippet}
        </Field>
      </div>
      {#if editing}
        {#if log?.costEntryId}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.fuel_cost_entry_hint()}
            <a
              href={resolve(`/costs/${log.costEntryId}` as "/")}
              class="text-brand font-medium underline underline-offset-4"
            >
              {m.fuel_cost_entry_open()}
            </a>
          </p>
        {/if}
      {:else}
        <SplitEditor
          id="fuel-split"
          bind:mode={draft.splitMode}
          bind:shares={draft.shares}
          {people}
          {amountMinor}
          currency={draft.currency}
          error={errors.shares}
        />
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>
</FormDialog>
