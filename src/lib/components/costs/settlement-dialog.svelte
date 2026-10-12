<script lang="ts">
  import ArrowLeftRightIcon from "@lucide/svelte/icons/arrow-left-right";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import {
    SETTLEMENT_NOTE_MAX,
    type Settlement,
  } from "$lib/api/schemas/settlements";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    buildSettlementBody,
    buildSettlementUpdate,
    draftFromSettlement,
    emptySettlementDraft,
    swapParties,
    type SettlementDefaults,
    type SettlementDraft,
  } from "$lib/costs/settlements";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let {
    open = $bindable(false),
    settlement,
    prefill,
    people,
    books,
    defaults,
    onsaved,
  }: {
    open?: boolean;
    /** The payment to edit; undefined records a new one. */
    settlement?: Settlement | undefined;
    /** What a new payment starts with (a suggested payment); without it the form starts empty. */
    prefill?: SettlementDraft | undefined;
    people: DirectoryUser[];
    /** Every book: a payment may name an archived one. */
    books: CostBook[];
    defaults: SettlementDefaults & { fromUserId?: string };
    onsaved: (saved: Settlement) => void | Promise<void>;
  } = $props();

  /* Seeded again each time the dialog opens. */
  let draft = $state<SettlementDraft>(
    untrack(() => emptySettlementDraft(defaults)),
  );
  let errors = $state<Record<string, string>>({});

  const editing = $derived(settlement !== undefined);

  $effect(() => {
    if (!open) return;
    draft = settlement
      ? draftFromSettlement(settlement)
      : (prefill ?? emptySettlementDraft(defaults));
    errors = {};
  });

  const personOptions = $derived(
    people.map((p) => ({ value: p.id, label: p.displayName })),
  );
  const bookOptions = $derived([
    { value: "", label: m.costbook_all() },
    ...books.map((book) => ({
      value: book.id,
      label: book.archivedAt
        ? m.cost_book_archived_option({ name: book.name })
        : book.name,
    })),
  ]);

  const nameOf = (id: string) =>
    people.find((p) => p.id === id)?.displayName ?? m.cost_person_unknown();

  async function submit(): Promise<string | void> {
    errors = {};
    const built = settlement
      ? buildSettlementUpdate(draft, settlement)
      : buildSettlementBody(draft);
    errors = built.errors;
    if (!built.body) return m.form_check_fields();
    try {
      if (settlement) {
        if (Object.keys(built.body).length === 0) return;
        const saved = await api.call(endpoints.settlementsUpdate, {
          params: { id: settlement.id },
          body: built.body,
        });
        toast.success(m.settlement_saved_toast());
        await onsaved(saved);
      } else {
        const saved = await api.call(endpoints.settlementsCreate, {
          body: built.body as never,
        });
        toast.success(
          m.settlement_created_toast({
            from: saved.fromName ?? nameOf(saved.fromUserId),
            to: saved.toName ?? nameOf(saved.toUserId),
            amount: formatMoney(saved.amountMinor, saved.currency),
          }),
        );
        await onsaved(saved);
      }
    } catch (err) {
      errors = apiFieldErrors(err);
      throw err;
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.settlement_edit_title() : m.settlement_create_title()}
  description={m.settlement_dialog_description()}
  submitLabel={editing ? m.common_save() : m.settlement_submit()}
  onsubmit={submit}
  class="sm:max-w-lg"
>
  <div
    class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-2 gap-y-5 max-sm:grid-cols-1"
  >
    <Field
      id="settlement-from"
      label={m.settlement_from()}
      error={errors.fromUserId}
    >
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="settlement-from"
          bind:value={draft.fromUserId}
          options={personOptions}
          placeholder={m.settlement_person_placeholder()}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      class="mt-[1.625rem] max-sm:mt-0 max-sm:rotate-90 max-sm:justify-self-center"
      aria-label={m.settlement_swap()}
      title={m.settlement_swap()}
      onclick={() => (draft = swapParties(draft))}
    >
      <ArrowLeftRightIcon />
    </Button>
    <Field id="settlement-to" label={m.settlement_to()} error={errors.toUserId}>
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="settlement-to"
          bind:value={draft.toUserId}
          options={personOptions}
          placeholder={m.settlement_person_placeholder()}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  </div>

  <div class="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
    <Field
      id="settlement-amount"
      label={m.cost_amount()}
      error={errors.amountMinor}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="settlement-amount"
          class="h-10 text-end tabular-nums"
          type="text"
          inputmode="decimal"
          required
          autocomplete="off"
          placeholder="0.00"
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.amount}
        />
      {/snippet}
    </Field>
    <Field
      id="settlement-currency"
      label={m.cost_currency()}
      error={errors.currency}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="settlement-currency"
          class="h-10 uppercase"
          maxlength={3}
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          value={draft.currency}
          oninput={(event) =>
            (draft.currency = event.currentTarget.value
              .toUpperCase()
              .replace(/[^A-Z]/g, ""))}
        />
      {/snippet}
    </Field>
  </div>

  <Field id="settlement-date" label={m.cost_date()} error={errors.date}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="settlement-date"
        class="h-10"
        type="date"
        required
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.date}
      />
    {/snippet}
  </Field>

  <Field
    id="settlement-book"
    label={m.cost_book()}
    hint={m.settlement_book_hint()}
    error={errors.bookId}
  >
    {#snippet children({ describedby, invalid })}
      <OptionSelect
        id="settlement-book"
        bind:value={draft.bookId}
        options={bookOptions}
        {invalid}
        {describedby}
      />
    {/snippet}
  </Field>

  <Field
    id="settlement-note"
    label={m.settlement_note()}
    optional
    error={errors.note}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="settlement-note"
        class="h-10"
        autocomplete="off"
        maxlength={SETTLEMENT_NOTE_MAX}
        placeholder={m.settlement_note_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.note}
      />
    {/snippet}
  </Field>
</FormDialog>
