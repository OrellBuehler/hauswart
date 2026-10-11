<script lang="ts">
  import { MAX_ODOMETER_VALUE } from "$lib/api/schemas/vehicles";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { completeTask } from "$lib/tasks/actions";
  import { readingToSend } from "$lib/vehicles/odometer-input";
  import { refusedMessage, refusedReading } from "$lib/vehicles/odometer-error";
  import { VehicleReading } from "$lib/vehicles/odometer-state.svelte";
  import OdometerReadingField from "./odometer-reading-field.svelte";

  let {
    open = $bindable(false),
    task,
    assetId,
    onsettled,
  }: {
    open?: boolean;
    task: { id: string; title: string; assetId?: string | null | undefined };
    assetId: string;
    onsettled?: () => void;
  } = $props();

  const vehicle = new VehicleReading();
  let odometer = $state("");
  let error = $state<string | undefined>();

  $effect(() => {
    if (!open) return;
    odometer = "";
    error = undefined;
    return vehicle.load(assetId);
  });

  async function submit(): Promise<string | void> {
    const reading = readingToSend(odometer, vehicle.known, MAX_ODOMETER_VALUE);
    if (!reading.ok) {
      error = m.vehicle_odometer_invalid({
        max: MAX_ODOMETER_VALUE.toLocaleString("en"),
      });
      return m.form_check_fields();
    }
    error = undefined;
    try {
      await completeTask(
        task,
        reading.value === null ? {} : { counterValue: reading.value },
      );
      onsettled?.();
    } catch (err) {
      const refused = refusedReading(err, "counterValue");
      if (refused) {
        error = refusedMessage(refused, vehicle.unit);
        return m.form_check_fields();
      }
      if (Object.keys(apiFieldErrors(err)).length > 0) {
        error = m.field_invalid();
        return m.form_check_fields();
      }
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={m.task_complete_dialog_title()}
  description={m.task_complete_odometer_description({ title: task.title })}
  submitLabel={m.task_complete()}
  pendingLabel={m.task_completing()}
  onsubmit={submit}
>
  <OdometerReadingField
    id="complete-odometer"
    vehicle={vehicle.state}
    bind:value={odometer}
    {error}
    enterkeyhint="done"
  />
</FormDialog>
