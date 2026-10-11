<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { TireSet } from "$lib/api/schemas/tire-sets";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { refusedMessage, refusedReading } from "$lib/vehicles/odometer-error";
  import type { VehicleReadingState } from "$lib/vehicles/odometer-state.svelte";
  import { buildMount } from "$lib/vehicles/tire-form";
  import { setTitle } from "$lib/vehicles/tire-label";
  import OdometerReadingField from "./odometer-reading-field.svelte";

  let {
    open = $bindable(false),
    assetId,
    set,
    today,
    vehicle,
    onmounted,
  }: {
    open?: boolean;
    assetId: string;
    set: TireSet | undefined;
    today: string;
    vehicle: VehicleReadingState;
    onmounted: () => void | Promise<void>;
  } = $props();

  let date = $state("");
  let odometer = $state("");
  let errors = $state<Record<string, string>>({});

  const unit = $derived(vehicle.phase === "ready" ? vehicle.unit : "km");
  const known = $derived(
    vehicle.phase === "ready" ? (vehicle.latest?.value ?? null) : null,
  );
  const name = $derived(set ? setTitle(set) : "");

  $effect(() => {
    if (!open) return;
    date = today;
    odometer = "";
    errors = {};
  });

  async function submit(): Promise<string | void> {
    if (!set) return;
    const built = buildMount({ date, odometer, known, today });
    errors = built.errors;
    if (!built.body) return m.form_check_fields();
    try {
      await api.call(endpoints.tireSetsMount, {
        params: { id: assetId, setId: set.id },
        body: built.body,
      });
      toast.success(m.tire_mounted_toast({ name }));
      await onmounted();
    } catch (err) {
      const refused = refusedReading(err, "odometer");
      if (refused) {
        errors = { odometer: refusedMessage(refused, unit) };
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err, { conflict: m.tire_error_not_mountable() });
    }
  }
</script>

<FormDialog
  bind:open
  title={m.tire_mount_title()}
  description={m.tire_mount_description({ name })}
  submitLabel={m.tire_mount_submit()}
  pendingLabel={m.tire_mount_pending()}
  onsubmit={submit}
>
  <Field id="tire-mount-date" label={m.tire_mount_date()} error={errors.date}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="tire-mount-date"
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
  <OdometerReadingField
    id="tire-mount-odometer"
    {vehicle}
    bind:value={odometer}
    error={errors.odometer}
    enterkeyhint="done"
  />
</FormDialog>
