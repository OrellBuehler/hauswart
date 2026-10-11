<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { OdometerUnit } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import {
    MAX_ODOMETER_VALUE,
    type OdometerSummary,
  } from "$lib/api/schemas/vehicles";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { isValidDate } from "$lib/dates";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay, formatNumber } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { formatOdometer, parseOdometerValue } from "$lib/vehicles/format";
  import {
    refusedMessage,
    refusedReading,
    refusedShort,
    type RefusedReading,
  } from "$lib/vehicles/odometer-error";

  let {
    open = $bindable(false),
    assetId,
    unit,
    today,
    latest = null,
    onsaved,
  }: {
    open?: boolean;
    assetId: string;
    unit: OdometerUnit;
    /** The household's today: the date a reading gets unless the person picks another. */
    today: string;
    /** The newest reading; shown as a reference. */
    latest?: OdometerSummary | null;
    onsaved: () => void | Promise<void>;
  } = $props();

  let date = $state("");
  let value = $state("");
  let note = $state("");
  let errors = $state<Record<string, string>>({});
  /** The server refused the entry as lower than the reading before or higher than the one after; what was typed then. */
  let refusal = $state<
    (RefusedReading & { forValue: string; forDate: string }) | null
  >(null);

  /** The person has seen the warning for exactly this entry and sends it again: `force`. */
  const confirmed = $derived(
    refusal !== null && refusal.forValue === value && refusal.forDate === date,
  );

  $effect(() => {
    if (!open) return;
    date = today;
    value = "";
    note = "";
    errors = {};
    refusal = null;
  });

  async function submit(): Promise<string | void> {
    const found: Record<string, string> = {};
    const reading = parseOdometerValue(value, MAX_ODOMETER_VALUE);
    if (reading === null) found.value = m.field_required();
    else if (reading === undefined) {
      found.value = m.vehicle_odometer_invalid({
        max: formatNumber(MAX_ODOMETER_VALUE),
      });
    }
    if (!date) found.date = m.field_required();
    else if (!isValidDate(date)) found.date = m.field_invalid_date();
    else if (date > today) found.date = m.vehicle_odometer_date_future();
    errors = found;
    if (Object.keys(found).length > 0 || typeof reading !== "number") {
      return m.form_check_fields();
    }

    try {
      const saved = await api.call(endpoints.odometerCreate, {
        params: { id: assetId },
        body: {
          date,
          value: reading,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(confirmed ? { force: true } : {}),
        },
      });
      toast.success(
        m.vehicle_odometer_saved_toast({
          value: formatOdometer(saved.value, unit),
        }),
      );
      await onsaved();
    } catch (err) {
      const refused = refusedReading(err, "value");
      if (refused) {
        refusal = { ...refused, forValue: value, forDate: date };
        errors = { value: refusedShort(refused) };
        return refusedMessage(refused, unit, { canForce: true });
      }
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={m.vehicle_record_odometer()}
  description={m.vehicle_odometer_dialog_description()}
  submitLabel={confirmed ? m.vehicle_odometer_save_anyway() : m.common_save()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  <Field
    id="odometer-value"
    label={m.vehicle_odometer_value({ unit })}
    hint={latest
      ? m.vehicle_odometer_latest({
          value: formatOdometer(latest.value, latest.unit),
          date: formatDay(latest.date),
        })
      : undefined}
    error={errors.value}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="odometer-value"
        class="h-10 tabular-nums"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value
      />
    {/snippet}
  </Field>
  <Field
    id="odometer-date"
    label={m.vehicle_odometer_date()}
    error={errors.date}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="odometer-date"
        class="h-10"
        type="date"
        max={today}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={date}
      />
    {/snippet}
  </Field>
  <Field
    id="odometer-note"
    label={m.vehicle_odometer_note()}
    optional
    error={errors.note}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="odometer-note"
        class="h-10"
        autocomplete="off"
        maxlength={500}
        placeholder={m.vehicle_odometer_note_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={note}
      />
    {/snippet}
  </Field>
</FormDialog>
