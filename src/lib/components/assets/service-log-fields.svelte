<script lang="ts">
  import { SERVICE_LOG_KINDS, type OdometerUnit } from "$lib/api/enums";
  import ContactSelect from "$lib/components/contacts/contact-select.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { serviceLogKindLabels } from "$lib/hints/labels";
  import { m } from "$lib/paraglide/messages";

  let {
    idPrefix,
    kind = $bindable("maintenance"),
    title = $bindable(""),
    description = $bindable(""),
    contactId = $bindable(null),
    cost = $bindable(""),
    odometer = $bindable(""),
    odometerUnit = null,
    date = $bindable(undefined),
    currency,
    errors = {},
    today,
  }: {
    idPrefix: string;
    kind?: string;
    title?: string;
    description?: string;
    contactId?: string | null;
    cost?: string;
    /** The odometer when the work was done, as typed; shown for a vehicle only (`odometerUnit` set). */
    odometer?: string;
    odometerUnit?: OdometerUnit | null;
    /** Shown when bound; the completion dialog uses the completion's date instead. */
    date?: string | undefined;
    currency: string;
    errors?: Record<string, string>;
    today?: string;
  } = $props();

  const kindOptions = SERVICE_LOG_KINDS.map((value) => ({
    value,
    label: serviceLogKindLabels[value](),
  }));
</script>

<div class="grid gap-5 sm:grid-cols-2">
  <Field id={`${idPrefix}-kind`} label={m.service_kind()}>
    {#snippet children({ describedby })}
      <OptionSelect
        id={`${idPrefix}-kind`}
        options={kindOptions}
        bind:value={kind}
        {describedby}
      />
    {/snippet}
  </Field>
  {#if date !== undefined}
    <Field id={`${idPrefix}-date`} label={m.service_date()} error={errors.date}>
      {#snippet children({ describedby, invalid })}
        <Input
          id={`${idPrefix}-date`}
          type="date"
          max={today}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10"
          bind:value={date}
        />
      {/snippet}
    </Field>
  {/if}
</div>
<Field id={`${idPrefix}-title`} label={m.service_title()} error={errors.title}>
  {#snippet children({ describedby, invalid })}
    <Input
      id={`${idPrefix}-title`}
      autocomplete="off"
      maxlength={200}
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
      class="h-10"
      bind:value={title}
    />
  {/snippet}
</Field>
<Field
  id={`${idPrefix}-description`}
  label={m.service_description()}
  optional
  error={errors.descriptionMd}
>
  {#snippet children({ describedby, invalid })}
    <Textarea
      id={`${idPrefix}-description`}
      rows={3}
      maxlength={50000}
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
      bind:value={description}
    />
  {/snippet}
</Field>
<div class="grid gap-5 sm:grid-cols-2">
  <Field
    id={`${idPrefix}-contact`}
    label={m.service_contact()}
    optional
    error={errors.contactId}
  >
    <ContactSelect id={`${idPrefix}-contact`} bind:value={contactId} />
  </Field>
  <Field
    id={`${idPrefix}-cost`}
    label={m.service_cost({ currency })}
    optional
    error={errors.costMinor}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id={`${idPrefix}-cost`}
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder="0.00"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10 tabular-nums"
        bind:value={cost}
      />
    {/snippet}
  </Field>
</div>
{#if odometerUnit}
  <Field
    id={`${idPrefix}-odometer`}
    label={m.service_odometer({ unit: odometerUnit })}
    optional
    hint={m.service_odometer_hint()}
    error={errors.odometer}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id={`${idPrefix}-odometer`}
        type="text"
        inputmode="decimal"
        autocomplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10 tabular-nums sm:max-w-56"
        bind:value={odometer}
      />
    {/snippet}
  </Field>
{/if}
