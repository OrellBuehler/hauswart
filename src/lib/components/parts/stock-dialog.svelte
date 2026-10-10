<script lang="ts">
  import MinusIcon from "@lucide/svelte/icons/minus";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { PartMovementReason } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { MAX_STOCK, type Part } from "$lib/api/schemas/parts";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { movementReasonLabels } from "$lib/parts/labels";

  type Direction = "more" | "less";

  let {
    open = $bindable(false),
    part,
    initialReason = "used",
    initialQty = 1,
    onsaved,
  }: {
    open?: boolean;
    part: Part;
    initialReason?: PartMovementReason;
    initialQty?: number;
    onsaved: () => void | Promise<void>;
  } = $props();

  let reason = $state<PartMovementReason>("used");
  let direction = $state<Direction>("more");
  let qty = $state<number | undefined>(1);
  let note = $state("");
  let qtyError = $state<string | undefined>();

  const reasonOptions = (
    ["used", "bought", "correction"] as PartMovementReason[]
  ).map((value) => ({ value, label: movementReasonLabels[value]() }));
  const directionOptions = $derived([
    { value: "more" as Direction, label: m.part_stock_more() },
    { value: "less" as Direction, label: m.part_stock_less() },
  ]);

  const delta = $derived.by(() => {
    const amount = qty ?? 0;
    return reason === "used" ||
      (reason === "correction" && direction === "less")
      ? -amount
      : amount;
  });
  const result = $derived(part.stockCount + delta);

  $effect(() => {
    if (!open) return;
    reason = initialReason;
    direction = "more";
    qty = initialQty;
    note = "";
    qtyError = undefined;
  });

  function step(by: number) {
    qty = Math.min(MAX_STOCK, Math.max(1, (qty ?? 0) + by));
  }

  async function submit(): Promise<string | void> {
    qtyError = undefined;
    if (qty === undefined || !Number.isInteger(qty) || qty < 1) {
      qtyError = m.field_min({ min: 1 });
      return m.form_check_fields();
    }
    if (result < 0) {
      qtyError = m.part_stock_below_zero();
      return m.form_check_fields();
    }
    try {
      await api.call(endpoints.partsStock, {
        params: { id: part.id },
        body: { delta, reason, note },
      });
    } catch (err) {
      return apiErrorMessage(err);
    }
    toast.success(m.part_stock_booked_toast({ name: part.name }));
    await onsaved();
  }
</script>

<FormDialog
  bind:open
  title={m.part_stock_dialog_title()}
  description={m.part_stock_dialog_description({
    name: part.name,
    count: part.stockCount,
  })}
  submitLabel={m.part_stock_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
  class="grid-cols-[minmax(0,1fr)] wrap-anywhere"
>
  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.part_stock_reason()}</span
    >
    <Segmented
      options={reasonOptions}
      bind:value={reason}
      label={m.part_stock_reason()}
      class="sm:w-full sm:[&>button]:flex-1"
    />
  </div>
  {#if reason === "correction"}
    <div class="flex flex-col gap-2">
      <span class="text-sm leading-none font-medium">
        {m.part_stock_direction()}
      </span>
      <Segmented
        options={directionOptions}
        bind:value={direction}
        label={m.part_stock_direction()}
        class="sm:w-full sm:[&>button]:flex-1"
      />
    </div>
  {/if}
  <Field id="stock-qty" label={m.part_stock_qty()} error={qtyError}>
    {#snippet children({ describedby, invalid })}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={m.part_stock_decrease()}
          disabled={(qty ?? 0) <= 1}
          onclick={() => step(-1)}
        >
          <MinusIcon />
        </Button>
        <NumberField
          id="stock-qty"
          bind:value={qty}
          {invalid}
          {describedby}
          class="max-w-24 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={m.part_stock_increase()}
          onclick={() => step(1)}
        >
          <PlusIcon />
        </Button>
        <p
          class="text-muted-foreground basis-full text-sm tabular-nums sm:ms-auto sm:basis-auto sm:text-end"
          aria-live="polite"
        >
          {m.part_stock_result({ count: result })}
        </p>
      </div>
    {/snippet}
  </Field>
  <Field id="stock-note" label={m.part_stock_note()} optional>
    {#snippet children({ describedby })}
      <Input
        id="stock-note"
        autocomplete="off"
        maxlength={500}
        aria-describedby={describedby}
        class="h-10"
        bind:value={note}
      />
    {/snippet}
  </Field>
</FormDialog>
