<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { TireSet } from "$lib/api/schemas/tire-sets";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatNumber } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { refusedMessage, refusedReading } from "$lib/vehicles/odometer-error";
  import type { VehicleReadingState } from "$lib/vehicles/odometer-state.svelte";
  import { buildTread } from "$lib/vehicles/tire-form";
  import { setTitle } from "$lib/vehicles/tire-label";
  import { TREAD_WARNING_MM } from "$lib/vehicles/tires";
  import OdometerReadingField from "./odometer-reading-field.svelte";

  let {
    open = $bindable(false),
    set,
    today,
    vehicle,
    onsaved,
  }: {
    open?: boolean;
    set: TireSet | undefined;
    today: string;
    vehicle: VehicleReadingState;
    onsaved: () => void | Promise<void>;
  } = $props();

  let date = $state("");
  let depth = $state("");
  let odometer = $state("");
  let errors = $state<Record<string, string>>({});

  const unit = $derived(vehicle.phase === "ready" ? vehicle.unit : "km");
  const known = $derived(
    vehicle.phase === "ready" ? (vehicle.latest?.value ?? null) : null,
  );

  $effect(() => {
    if (!open) return;
    date = today;
    depth = "";
    odometer = "";
    errors = {};
  });

  async function submit(): Promise<string | void> {
    if (!set) return;
    const built = buildTread({ date, depth, odometer, known, today });
    errors = built.errors;
    if (!built.body) return m.form_check_fields();
    try {
      const saved = await api.call(endpoints.tireSetsTread, {
        params: { id: set.id },
        body: built.body,
      });
      toast.success(
        m.tire_tread_saved_toast({
          depth: formatNumber(saved.treadDepthMm ?? built.body.treadDepthMm),
        }),
      );
      await onsaved();
    } catch (err) {
      const refused = refusedReading(err, "odometer");
      if (refused) {
        errors = { odometer: refusedMessage(refused, unit) };
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={m.tire_tread_title()}
  description={set ? m.tire_tread_description({ name: setTitle(set) }) : ""}
  submitLabel={m.common_save()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  <Field
    id="tire-tread-depth"
    label={m.tire_tread_depth()}
    hint={m.tire_tread_hint({
      summer: TREAD_WARNING_MM.summer,
      winter: TREAD_WARNING_MM.winter,
    })}
    error={errors.treadDepthMm}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="tire-tread-depth"
        class="h-10 tabular-nums sm:max-w-40"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        enterkeyhint="next"
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={depth}
      />
    {/snippet}
  </Field>
  <Field id="tire-tread-date" label={m.tire_tread_date()} error={errors.date}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="tire-tread-date"
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
    id="tire-tread-odometer"
    {vehicle}
    bind:value={odometer}
    error={errors.odometer}
    enterkeyhint="done"
  />
</FormDialog>
