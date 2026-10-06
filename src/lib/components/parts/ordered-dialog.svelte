<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { MAX_STOCK, type Part } from "$lib/api/schemas/parts";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    part,
    onsaved,
  }: {
    open?: boolean;
    part: Part;
    onsaved: () => void | Promise<void>;
  } = $props();

  let qty = $state<number | undefined>(1);
  let qtyError = $state<string | undefined>();

  $effect(() => {
    if (!open) return;
    qty = part.orderedQty > 0 ? part.orderedQty : part.reorderQty;
    qtyError = undefined;
  });

  async function submit(): Promise<string | void> {
    qtyError = undefined;
    if (
      qty === undefined ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_STOCK
    ) {
      qtyError = m.field_min({ min: 1 });
      return m.form_check_fields();
    }
    try {
      await api.call(endpoints.partsOrdered, {
        params: { id: part.id },
        body: { qty },
      });
    } catch (err) {
      return apiErrorMessage(err);
    }
    toast.success(m.part_ordered_toast({ name: part.name }));
    await onsaved();
  }
</script>

<FormDialog
  bind:open
  title={m.part_ordered_dialog_title()}
  description={m.part_ordered_dialog_description({ name: part.name })}
  submitLabel={m.part_ordered_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  <Field id="ordered-qty" label={m.part_ordered_qty()} error={qtyError}>
    {#snippet children({ describedby, invalid })}
      <NumberField
        id="ordered-qty"
        bind:value={qty}
        {invalid}
        {describedby}
        class="max-w-32"
      />
    {/snippet}
  </Field>
</FormDialog>
