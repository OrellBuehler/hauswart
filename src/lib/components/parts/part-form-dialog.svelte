<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { MAX_STOCK, type Part } from "$lib/api/schemas/parts";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { readMoney } from "$lib/format-money";
  import { toDecimalString, minor } from "$lib/money";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let {
    open = $bindable(false),
    part,
    currency,
    initialName = "",
    onsaved,
  }: {
    open?: boolean;
    /** The part to edit; undefined creates a new one. */
    part?: Part | undefined;
    /** The household's currency, used for a new part. */
    currency: string;
    initialName?: string;
    onsaved: (part: Part) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let partNumber = $state("");
  let supplier = $state("");
  let shopUrl = $state("");
  let price = $state("");
  let stockCount = $state<number | undefined>(0);
  let minStock = $state<number | undefined>(0);
  let reorderQty = $state<number | undefined>(1);
  let leadTimeDays = $state<number | undefined>(14);
  let notes = $state("");
  let fieldErrors = $state<Record<string, string>>({});

  const editing = $derived(part !== undefined);
  const partCurrency = $derived(part?.currency ?? currency);

  $effect(() => {
    if (!open) return;
    name = part?.name ?? initialName;
    partNumber = part?.partNumber ?? "";
    supplier = part?.supplier ?? "";
    shopUrl = part?.shopUrl ?? "";
    price =
      part?.unitPriceMinor == null
        ? ""
        : toDecimalString(minor(part.unitPriceMinor), 2);
    stockCount = 0;
    minStock = part?.minStock ?? 0;
    reorderQty = part?.reorderQty ?? 1;
    leadTimeDays = part?.leadTimeDays ?? 14;
    notes = part?.notes ?? "";
    fieldErrors = {};
  });

  function whole(value: number | undefined, max: number, min = 0) {
    return (
      value !== undefined &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max
    );
  }

  async function submit(): Promise<string | void> {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = m.field_required();
    const unitPriceMinor = readMoney(price, partCurrency);
    if (unitPriceMinor === undefined) errors.unitPriceMinor = m.field_number();
    if (!editing && !whole(stockCount, MAX_STOCK)) {
      errors.stockCount = m.field_number();
    }
    if (!whole(minStock, MAX_STOCK)) errors.minStock = m.field_number();
    if (!whole(reorderQty, MAX_STOCK, 1))
      errors.reorderQty = m.field_min({ min: 1 });
    if (!whole(leadTimeDays, 3650)) errors.leadTimeDays = m.field_number();
    fieldErrors = errors;
    if (Object.keys(errors).length > 0) return m.form_check_fields();

    const fields = {
      name,
      partNumber,
      supplier,
      shopUrl,
      unitPriceMinor: unitPriceMinor ?? null,
      currency: partCurrency,
      minStock: minStock!,
      reorderQty: reorderQty!,
      leadTimeDays: leadTimeDays!,
      notes,
    };
    try {
      const saved = part
        ? await api.call(endpoints.partsUpdate, {
            params: { id: part.id },
            body: fields,
          })
        : await api.call(endpoints.partsCreate, {
            body: { ...fields, stockCount: stockCount! },
          });
      toast.success(
        editing
          ? m.part_saved_toast({ name: saved.name })
          : m.part_created_toast({ name: saved.name }),
      );
      await onsaved(saved);
    } catch (err) {
      fieldErrors = apiFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.part_edit_title() : m.part_create_title()}
  description={editing
    ? m.part_edit_description()
    : m.part_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <Field id="part-name" label={m.part_name()} error={fieldErrors.name}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="part-name"
        autocomplete="off"
        maxlength={160}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={name}
      />
    {/snippet}
  </Field>
  <div class="grid gap-5 sm:grid-cols-2">
    <Field
      id="part-number"
      label={m.part_number()}
      optional
      error={fieldErrors.partNumber}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="part-number"
          autocomplete="off"
          maxlength={120}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10"
          bind:value={partNumber}
        />
      {/snippet}
    </Field>
    <Field
      id="part-supplier"
      label={m.part_supplier()}
      optional
      error={fieldErrors.supplier}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="part-supplier"
          autocomplete="off"
          maxlength={160}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10"
          bind:value={supplier}
        />
      {/snippet}
    </Field>
  </div>
  <Field
    id="part-shop"
    label={m.part_shop_url()}
    optional
    error={fieldErrors.shopUrl}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="part-shop"
        type="url"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        maxlength={2048}
        placeholder="https://"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={shopUrl}
      />
    {/snippet}
  </Field>
  <div class="grid grid-cols-2 gap-5">
    <Field
      id="part-price"
      label={m.part_price({ currency: partCurrency })}
      optional
      error={fieldErrors.unitPriceMinor}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="part-price"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0.00"
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10 tabular-nums"
          bind:value={price}
        />
      {/snippet}
    </Field>
    {#if !editing}
      <Field
        id="part-stock"
        label={m.part_initial_stock()}
        error={fieldErrors.stockCount}
      >
        {#snippet children({ describedby, invalid })}
          <NumberField
            id="part-stock"
            bind:value={stockCount}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    {/if}
  </div>
  <div class="grid grid-cols-2 gap-5 sm:grid-cols-3">
    <Field
      id="part-min"
      label={m.part_min_stock()}
      error={fieldErrors.minStock}
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="part-min"
          bind:value={minStock}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field
      id="part-reorder"
      label={m.part_reorder_qty()}
      error={fieldErrors.reorderQty}
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="part-reorder"
          bind:value={reorderQty}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field
      id="part-lead"
      label={m.part_lead_time()}
      error={fieldErrors.leadTimeDays}
      class="max-sm:col-span-2"
    >
      {#snippet children({ describedby, invalid })}
        <NumberField
          id="part-lead"
          bind:value={leadTimeDays}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  </div>
  <p class="text-muted-foreground -mt-2 text-xs text-pretty">
    {m.part_stock_fields_hint()}
  </p>
  <Field
    id="part-notes"
    label={m.part_notes()}
    optional
    error={fieldErrors.notes}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="part-notes"
        rows={3}
        maxlength={10000}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={notes}
      />
    {/snippet}
  </Field>
</FormDialog>
