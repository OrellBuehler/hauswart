<script lang="ts">
  import { untrack } from "svelte";
  import {
    ASSET_KINDS,
    COST_CATEGORIES,
    COST_CATEGORY_COUNTS_AS_EXPENSE,
    COST_DEDUCTIBLE,
    type AssetKind,
    type CostCategory,
    type CostDeductible,
    type CostSplitMode,
  } from "$lib/api/enums";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import { COST_NOTES_MAX, COST_TITLE_MAX } from "$lib/api/schemas/costs";
  import type {
    AcceptFinanceSuggestionRequest,
    FinanceSuggestion,
  } from "$lib/api/schemas/finance";
  import type { Room } from "$lib/api/schemas/rooms";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { acceptBook, openBooks } from "$lib/costs/books";
  import {
    chosenParticipants,
    equalShares,
    narrowedParticipants,
    splitAfterBook,
    validateShares,
  } from "$lib/costs/form";
  import { kindLabels } from "$lib/assets/kinds";
  import { categoryLabels, deductibleLabels } from "$lib/costs/labels";
  import { formatDay } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import BookPicker from "./book-picker.svelte";
  import SplitEditor from "./split-editor.svelte";

  let {
    open = $bindable(false),
    suggestion,
    rooms,
    assets,
    people,
    books,
    currentUserId,
    onaccept,
  }: {
    open?: boolean;
    suggestion: Exclude<FinanceSuggestion, { kind: "link" }>;
    rooms: Room[];
    assets: Asset[];
    people: DirectoryUser[];
    /** Every cost book; the suggestion goes to one that takes entries. */
    books: CostBook[];
    currentUserId: string;
    /** Books the suggestion with the overrides; a thrown API error is shown in the dialog. */
    onaccept: (body: AcceptFinanceSuggestionRequest) => Promise<void>;
  } = $props();

  const userIds = untrack(() => people.map((p) => p.id));
  const cost = untrack(() =>
    suggestion.kind === "cost" ? suggestion.payload : undefined,
  );

  let title = $state(
    untrack(() =>
      suggestion.kind === "asset"
        ? suggestion.payload.name
        : suggestion.payload.title,
    ),
  );
  let errors = $state<Record<string, string>>({});

  let category = $state<CostCategory>(cost?.category ?? "other");
  let assetId = $state(cost?.assetId ?? "");
  let roomId = $state("");
  let notes = $state("");
  let paidByUserId = $state(
    untrack(() => (userIds.includes(currentUserId) ? currentUserId : "")),
  );
  /** The book the person's settings offered with the suggestion, else the default book. */
  const startBook = untrack(() => acceptBook(books, cost?.bookId));
  let bookId = $state(startBook?.id ?? "");
  let splitMode = $state<CostSplitMode>(
    startBook?.defaultSplitMode ?? "ownership",
  );
  let splitTouched = $state(false);
  let participants = $state<string[]>(untrack(() => [...userIds]));
  let shares = $state<Record<string, string>>(
    untrack(() => equalShares(userIds)),
  );
  let countsAsExpense = $state(
    cost ? COST_CATEGORY_COUNTS_AS_EXPENSE[cost.category] : true,
  );
  let countsTouched = $state(false);
  let deductible = $state<CostDeductible>("unknown");
  let assetKind = $state<AssetKind>("device");

  const categoryOptions = COST_CATEGORIES.map((c) => ({
    value: c,
    label: categoryLabels[c](),
  }));
  const deductibleOptions = COST_DEDUCTIBLE.map((d) => ({
    value: d,
    label: deductibleLabels[d](),
  }));
  const kindOptions = ASSET_KINDS.map((k) => ({
    value: k,
    label: kindLabels[k](),
  }));
  const selectableBooks = $derived(openBooks(books));
  const book = $derived(books.find((b) => b.id === bookId));
  const taxApplies = $derived(book?.taxRelevant ?? true);

  const roomOptions = $derived([
    { value: "", label: m.cost_no_room() },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const assetOptions = $derived([
    { value: "", label: m.cost_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const payerOptions = $derived([
    { value: "", label: m.cost_payer_none() },
    ...people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);

  function pickBook(next: string) {
    const picked = books.find((b) => b.id === next);
    if (!picked) return;
    bookId = picked.id;
    splitMode = splitAfterBook({ splitMode, splitTouched }, picked, true);
  }

  function pickCategory(next: string) {
    category = next as CostCategory;
    if (!countsTouched)
      countsAsExpense = COST_CATEGORY_COUNTS_AS_EXPENSE[category];
  }

  async function submit(): Promise<string | void> {
    errors = {};
    const trimmed = title.trim();
    if (!trimmed) {
      errors.title = m.field_required();
      return m.form_check_fields();
    }
    const body: AcceptFinanceSuggestionRequest = {};
    if (suggestion.kind === "bill_task") {
      if (trimmed !== suggestion.payload.title) body.title = trimmed;
    } else if (suggestion.kind === "asset") {
      if (trimmed !== suggestion.payload.name) body.name = trimmed;
      if (assetKind !== "device") body.assetKind = assetKind;
      if (roomId) body.roomId = roomId;
    } else if (cost) {
      if (trimmed !== suggestion.payload.title) body.title = trimmed;
      if (category !== cost.category) body.category = category;
      if (assetId !== (cost.assetId ?? "")) body.assetId = assetId || null;
      if (roomId) body.roomId = roomId;
      if (notes.trim()) body.notes = notes.trim();
      const defaultPayer = userIds.includes(currentUserId) ? currentUserId : "";
      if (paidByUserId !== defaultPayer)
        body.paidByUserId = paidByUserId || null;
      // Without a book the server takes the offered one (or the default book), which is where this dialog started.
      if (bookId && bookId !== acceptBook(books, cost.bookId)?.id) {
        body.bookId = bookId;
      }
      // Without a split the book's own applies.
      const bookSplit = book?.defaultSplitMode ?? "ownership";
      if (splitMode !== bookSplit) body.splitMode = splitMode;
      if (splitMode === "equal") {
        const chosen = chosenParticipants({ participants }, userIds);
        if (chosen.length === 0) {
          errors.participantIds = m.cost_for_whom_none();
          return m.form_check_fields();
        }
        const narrowed = narrowedParticipants(chosen, userIds);
        if (narrowed) {
          body.splitMode = "equal";
          body.participantIds = narrowed;
        }
      }
      if (splitMode === "custom") {
        const checked = validateShares(shares, userIds);
        if (checked.error) {
          errors.shares = checked.error;
          return m.form_check_fields();
        }
        body.shares = checked.items;
      }
      if (countsTouched || category !== cost.category) {
        body.countsAsExpense = countsAsExpense;
      }
      if (taxApplies && deductible !== "unknown") body.deductible = deductible;
    }
    await onaccept(body);
  }

  const facts = $derived.by(() => {
    switch (suggestion.kind) {
      case "cost":
        return [
          formatDay(suggestion.payload.date),
          formatMoney(
            suggestion.payload.amountMinor,
            suggestion.payload.currency,
          ),
          suggestion.payload.payee,
        ];
      case "asset":
        return [
          formatDay(suggestion.payload.purchaseDate),
          formatMoney(
            suggestion.payload.priceMinor,
            suggestion.payload.currency,
          ),
        ];
      case "bill_task":
        return [
          formatDay(suggestion.payload.dueDate),
          suggestion.payload.amountMinor === null
            ? null
            : formatMoney(
                suggestion.payload.amountMinor,
                suggestion.payload.currency,
              ),
        ];
    }
  });

  const dialogTitle = $derived(
    suggestion.kind === "cost"
      ? m.finance_accept_cost_title()
      : suggestion.kind === "asset"
        ? m.finance_accept_asset_title()
        : m.finance_accept_bill_task_title(),
  );
</script>

<FormDialog
  bind:open
  title={dialogTitle}
  description={m.finance_accept_description()}
  submitLabel={suggestion.kind === "cost"
    ? m.finance_accept_cost()
    : suggestion.kind === "asset"
      ? m.finance_accept_asset()
      : m.finance_accept_bill_task()}
  pendingLabel={m.finance_accepting()}
  onsubmit={submit}
  class="sm:max-w-xl"
>
  <p class="text-muted-foreground -mt-2 text-sm break-words tabular-nums">
    {facts.filter(Boolean).join(" · ")}
  </p>

  <Field
    id="accept-title"
    label={suggestion.kind === "asset" ? m.asset_name() : m.cost_title()}
    error={errors.title}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="accept-title"
        class="h-10"
        maxlength={COST_TITLE_MAX}
        autocomplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={title}
      />
    {/snippet}
  </Field>

  {#if suggestion.kind === "asset"}
    <div class="grid gap-5 sm:grid-cols-2">
      <Field id="accept-asset-kind" label={m.asset_kind()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-asset-kind"
            value={assetKind}
            onchange={(v) => (assetKind = v as AssetKind)}
            options={kindOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="accept-room" label={m.cost_room()} optional>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-room"
            bind:value={roomId}
            options={roomOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </div>
  {:else if suggestion.kind === "cost" && cost}
    {#if selectableBooks.length > 1}
      <BookPicker
        id="accept-book"
        compact
        books={selectableBooks}
        bind:value={bookId}
        onchange={pickBook}
      />
    {/if}
    <div class="grid gap-5 sm:grid-cols-2">
      <Field id="accept-category" label={m.cost_category()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-category"
            value={category}
            options={categoryOptions}
            onchange={pickCategory}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="accept-payer" label={m.cost_paid_by()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-payer"
            bind:value={paidByUserId}
            options={payerOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="accept-asset" label={m.cost_asset()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-asset"
            bind:value={assetId}
            options={assetOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="accept-room" label={m.cost_room()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-room"
            bind:value={roomId}
            options={roomOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </div>

    <SplitEditor
      id="accept-split"
      bind:mode={splitMode}
      bind:shares
      bind:participants
      {people}
      amountMinor={cost.amountMinor}
      currency={cost.currency}
      error={errors.shares}
      participantsError={errors.participantIds}
      onmodechange={() => (splitTouched = true)}
    />

    <SwitchField
      id="accept-counts"
      bind:checked={countsAsExpense}
      label={m.cost_counts_as_expense()}
      hint={m.cost_counts_as_expense_hint()}
      onchange={() => (countsTouched = true)}
    />

    {#if taxApplies}
      <Field id="accept-deductible" label={m.cost_deductible()}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="accept-deductible"
            value={deductible}
            onchange={(v) => (deductible = v as CostDeductible)}
            options={deductibleOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    {/if}

    <Field id="accept-notes" label={m.cost_notes()} optional>
      {#snippet children({ describedby, invalid })}
        <Textarea
          id="accept-notes"
          rows={2}
          maxlength={COST_NOTES_MAX}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={notes}
        />
      {/snippet}
    </Field>
  {/if}
</FormDialog>
