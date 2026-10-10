<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { OdometerUnit, ServiceLogKind } from "$lib/api/enums";
  import { MAX_ODOMETER_VALUE } from "$lib/api/schemas/vehicles";
  import { parseOdometerValue } from "$lib/vehicles/format";
  import { endpoints } from "$lib/api/registry";
  import type { ServiceLogEntry } from "$lib/api/schemas/service-log";
  import NoteChoices from "$lib/components/asset-notes/note-choices.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import { apiErrorMessage } from "$lib/error-message";
  import { readMoney } from "$lib/format-money";
  import { minor, toDecimalString } from "$lib/money";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import ServiceLogFields from "./service-log-fields.svelte";

  let {
    open = $bindable(false),
    assetId,
    entry,
    today,
    currency,
    odometerUnit = null,
    onsaved,
  }: {
    open?: boolean;
    assetId: string;
    /** The entry to edit; undefined adds a new one. */
    entry?: ServiceLogEntry | undefined;
    today: string;
    currency: string;
    /** The unit of the vehicle's odometer; set for a vehicle only, which asks for the odometer. */
    odometerUnit?: OdometerUnit | null;
    onsaved: () => void | Promise<void>;
  } = $props();

  let kind = $state<string>("maintenance");
  let date = $state<string | undefined>("");
  let title = $state("");
  let description = $state("");
  let contactId = $state<string | null>(null);
  let cost = $state("");
  let odometer = $state("");
  let resolvedNoteIds = $state<string[]>([]);
  let errors = $state<Record<string, string>>({});

  const editing = $derived(entry !== undefined);
  const entryCurrency = $derived(entry?.currency ?? currency);

  $effect(() => {
    if (!open) return;
    kind = entry?.kind ?? "maintenance";
    date = entry?.date ?? today;
    title = entry?.title ?? "";
    description = entry?.descriptionMd ?? "";
    contactId = entry?.contactId ?? null;
    cost =
      entry?.costMinor == null
        ? ""
        : toDecimalString(minor(entry.costMinor), 2);
    odometer = entry?.odometer == null ? "" : String(entry.odometer);
    resolvedNoteIds = [];
    errors = {};
  });

  async function submit(): Promise<string | void> {
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = m.field_required();
    if (!date) found.date = m.field_required();
    const costMinor = readMoney(cost, entryCurrency);
    if (costMinor === undefined) found.costMinor = m.field_number();
    const reading = odometerUnit
      ? parseOdometerValue(odometer, MAX_ODOMETER_VALUE)
      : null;
    if (reading === undefined) found.odometer = m.field_number();
    errors = found;
    if (Object.keys(found).length > 0) return m.form_check_fields();

    const fields = {
      date: date!,
      kind: kind as ServiceLogKind,
      title,
      descriptionMd: description,
      contactId,
      costMinor: costMinor ?? null,
      ...(costMinor === null || costMinor === undefined
        ? { currency: null }
        : { currency: entryCurrency }),
      ...(odometerUnit && (reading !== null || entry)
        ? { odometer: reading ?? null }
        : {}),
      ...(resolvedNoteIds.length > 0
        ? { resolvedNoteIds: [...resolvedNoteIds] }
        : {}),
    };
    try {
      const saved = entry
        ? await api.call(endpoints.assetServiceLogUpdate, {
            params: { id: assetId, entryId: entry.id },
            body: fields,
          })
        : await api.call(endpoints.assetServiceLogCreate, {
            params: { id: assetId },
            body: fields,
          });
      toast.success(
        editing
          ? m.service_saved_toast({ title: saved.title })
          : m.service_created_toast({ title: saved.title }),
      );
      await onsaved();
    } catch (err) {
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.service_edit_title() : m.service_create_title()}
  description={m.service_form_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <ServiceLogFields
    idPrefix="service"
    bind:kind
    bind:date
    bind:title
    bind:description
    bind:contactId
    bind:cost
    bind:odometer
    {odometerUnit}
    currency={entryCurrency}
    {errors}
    {today}
  />
  <NoteChoices
    {assetId}
    bind:selected={resolvedNoteIds}
    idPrefix="service-notes"
  />
</FormDialog>
