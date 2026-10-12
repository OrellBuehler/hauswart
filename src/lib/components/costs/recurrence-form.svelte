<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import XIcon from "@lucide/svelte/icons/x";
  import { onMount, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    COST_CATEGORIES,
    COST_CATEGORY_COUNTS_AS_EXPENSE,
    COST_DEDUCTIBLE,
    COST_RECURRENCE_FREQUENCIES,
    type CostCategory,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import type { CostTag } from "$lib/api/schemas/cost-tags";
  import { COST_NOTES_MAX, COST_TITLE_MAX } from "$lib/api/schemas/costs";
  import type { CostRecurrence } from "$lib/api/schemas/cost-recurrences";
  import type { Room } from "$lib/api/schemas/rooms";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { loadRememberedBook } from "$lib/costs/book-memory";
  import { openBooks } from "$lib/costs/books";
  import {
    parseDraftAmount,
    splitAfterBook,
    taxClassApplies,
  } from "$lib/costs/form";
  import { categoryLabels, deductibleLabels } from "$lib/costs/labels";
  import {
    buildRecurrenceCreateBody,
    buildRecurrenceUpdateBody,
    changesRule,
    draftFromRecurrence,
    newRecurrenceDraft,
    recurrenceBookClosed,
    ruleOfDraft,
    withStartDate,
    type RecurrenceDraft,
  } from "$lib/costs/recurrences";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";
  import BookPicker from "./book-picker.svelte";
  import RecurrencePreview from "./recurrence-preview.svelte";
  import SplitEditor from "./split-editor.svelte";
  import TagPicker from "./tag-picker.svelte";

  let {
    recurrence,
    rooms,
    assets,
    people,
    books,
    tags,
    currency,
    today,
    currentUserId,
    defaults = {},
  }: {
    /** The recurring cost to change; undefined sets up a new one. */
    recurrence?: CostRecurrence | undefined;
    rooms: Room[];
    assets: Asset[];
    people: DirectoryUser[];
    /** Every cost book, archived ones included. */
    books: CostBook[];
    tags: CostTag[];
    /** The household's currency. */
    currency: string;
    today: string;
    currentUserId: string;
    defaults?: { bookId?: string | undefined };
  } = $props();

  const userIds = untrack(() => people.map((p) => p.id));

  let draft = $state<RecurrenceDraft>(
    untrack(() =>
      recurrence
        ? draftFromRecurrence(recurrence, userIds)
        : newRecurrenceDraft({
            today,
            currency,
            paidByUserId: people.some((p) => p.id === currentUserId)
              ? currentUserId
              : "",
            userIds,
            books,
            ...defaults,
          }),
    ),
  );

  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let pending = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);

  const selectableBooks = $derived(
    books.filter(
      (book) => book.archivedAt === null || book.id === recurrence?.bookId,
    ),
  );
  const taxApplies = $derived(taxClassApplies(draft, books));
  const amount = $derived(
    parseDraftAmount(draft.amount, draft.refund, draft.currency),
  );
  const otherCurrency = $derived(
    /^[A-Z]{3}$/.test(draft.currency) && draft.currency !== currency,
  );
  const rule = $derived(ruleOfDraft(draft));
  /** A paused or finished recurring cost books nothing when it is saved. */
  const booking = $derived(
    !recurrence || (recurrence.active && recurrence.nextDate !== null),
  );
  const ruleHint = $derived(
    recurrence && changesRule(draft, recurrence)
      ? m.recurrence_edit_rule_hint()
      : undefined,
  );

  const categoryOptions = $derived(
    COST_CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c]() })),
  );
  const deductibleOptions = $derived(
    COST_DEDUCTIBLE.map((d) => ({ value: d, label: deductibleLabels[d]() })),
  );
  const kindOptions = $derived([
    { value: "expense" as const, label: m.cost_kind_expense() },
    { value: "refund" as const, label: m.cost_kind_refund() },
  ]);
  const frequencyOptions = $derived(
    COST_RECURRENCE_FREQUENCIES.map((value) => ({
      value,
      label:
        value === "monthly"
          ? m.recurrence_frequency_monthly()
          : value === "quarterly"
            ? m.recurrence_frequency_quarterly()
            : m.recurrence_frequency_yearly(),
    })),
  );
  const intervalCount = $derived(Number(draft.interval) || 1);
  const intervalUnit = $derived(
    draft.frequency === "monthly"
      ? m.recurrence_unit_monthly({ count: intervalCount })
      : draft.frequency === "quarterly"
        ? m.recurrence_unit_quarterly({ count: intervalCount })
        : m.recurrence_unit_yearly({ count: intervalCount }),
  );
  const assetOptions = $derived([
    { value: "", label: m.cost_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const roomOptions = $derived([
    { value: "", label: m.cost_no_room() },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const payerOptions = $derived([
    { value: "", label: m.cost_payer_none() },
    ...people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);
  const showPayerHint = $derived(
    draft.splitMode !== "none" && draft.paidByUserId === "",
  );

  function pickBook(next: string) {
    const picked = books.find((book) => book.id === next);
    if (!picked) return;
    draft.bookId = picked.id;
    draft.splitMode = splitAfterBook(draft, picked, !recurrence);
  }

  onMount(() => {
    // The page the form opened from could not name a book; the one looked at last on the costs page is the next guess.
    if (recurrence || defaults.bookId) return;
    const remembered = loadRememberedBook(currentUserId);
    const book = openBooks(books).find((b) => b.id === remembered);
    if (book && book.id !== draft.bookId) pickBook(book.id);
  });

  function pickCategory(next: string) {
    if (!draft.countsTouched) {
      draft.countsAsExpense =
        COST_CATEGORY_COUNTS_AS_EXPENSE[next as CostCategory];
    }
  }

  function onCurrencyInput(event: Event & { currentTarget: HTMLInputElement }) {
    draft.currency = event.currentTarget.value
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
  }

  function focusFirstError() {
    queueMicrotask(() => {
      const invalid = formEl?.querySelector<HTMLElement>(
        "[aria-invalid='true']",
      );
      invalid?.scrollIntoView({ block: "center" });
      invalid?.focus();
    });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    formError = undefined;
    const built = recurrence
      ? buildRecurrenceUpdateBody(draft, recurrence, userIds, books)
      : buildRecurrenceCreateBody(draft, userIds, books);
    errors = built.errors;
    if (!built.body) {
      formError = m.form_check_fields();
      focusFirstError();
      return;
    }
    if (recurrence && Object.keys(built.body).length === 0) {
      toast.info(m.cost_form_no_changes());
      await goto(resolve(`/costs/recurring/${recurrence.id}` as "/"));
      return;
    }
    pending = true;
    try {
      const saved = recurrence
        ? await api.call(endpoints.costRecurrencesUpdate, {
            params: { id: recurrence.id },
            body: built.body as never,
          })
        : await api.call(endpoints.costRecurrencesCreate, {
            body: built.body as never,
          });
      toast.success(
        recurrence
          ? m.recurrence_saved_toast({ title: saved.title })
          : m.recurrence_created_toast({ title: saved.title }),
      );
      await goto(resolve(`/costs/recurring/${saved.id}` as "/"), {
        invalidateAll: true,
      });
    } catch (err) {
      errors = apiFieldErrors(err);
      if (recurrenceBookClosed(err)) {
        errors.bookId = m.recurrence_error_book_closed();
      }
      formError = apiErrorMessage(err);
      focusFirstError();
    } finally {
      pending = false;
    }
  }

  const cancelHref = $derived(
    recurrence
      ? resolve(`/costs/recurring/${recurrence.id}` as "/")
      : resolve("/costs/recurring"),
  );
</script>

<form
  bind:this={formEl}
  class="flex flex-col gap-6"
  onsubmit={submit}
  novalidate
>
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.recurrence_form_template()}</Card.Title>
      <Card.Description
        >{m.recurrence_form_template_description()}</Card.Description
      >
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      {#if selectableBooks.length > 1}
        <BookPicker
          id="rec-book"
          books={selectableBooks}
          bind:value={draft.bookId}
          error={errors.bookId}
          onchange={pickBook}
        />
      {/if}

      <Field id="rec-title" label={m.cost_title()} error={errors.title}>
        {#snippet children({ describedby, invalid })}
          <Input
            id="rec-title"
            class="h-10"
            required
            maxlength={COST_TITLE_MAX}
            autocomplete="off"
            placeholder={m.recurrence_title_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.title}
          />
        {/snippet}
      </Field>

      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium">{m.cost_kind()}</span>
        <Segmented
          options={kindOptions}
          bind:value={
            () => (draft.refund ? "refund" : "expense"),
            (value) => (draft.refund = value === "refund")
          }
          label={m.cost_kind()}
        />
        {#if draft.refund}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.cost_kind_refund_hint()}
          </p>
        {/if}
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
        <Field
          id="rec-amount"
          label={m.cost_amount()}
          error={errors.amountMinor}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="rec-amount"
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
          id="rec-currency"
          label={m.cost_currency()}
          error={errors.currency}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="rec-currency"
              class="h-10 uppercase"
              maxlength={3}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              value={draft.currency}
              oninput={onCurrencyInput}
            />
          {/snippet}
        </Field>
      </div>
      {#if otherCurrency}
        <p
          class="text-muted-foreground -mt-2 text-xs text-pretty"
          aria-live="polite"
        >
          {m.cost_currency_other_hint({ currency })}
        </p>
      {/if}

      <Field
        id="rec-category"
        label={m.cost_category()}
        error={errors.category}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="rec-category"
            bind:value={draft.category}
            options={categoryOptions}
            onchange={pickCategory}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>

      <TagPicker
        id="rec-tags"
        {tags}
        bind:value={draft.tagIds}
        creatable
        disabled={pending}
        error={errors.tagIds}
      />

      <Field
        id="rec-notes"
        label={m.cost_notes()}
        optional
        error={errors.notes}
      >
        {#snippet children({ describedby, invalid })}
          <Textarea
            id="rec-notes"
            rows={3}
            maxlength={COST_NOTES_MAX}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.notes}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.recurrence_form_rule()}</Card.Title>
      <Card.Description>{m.recurrence_form_rule_description()}</Card.Description
      >
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium"
          >{m.recurrence_frequency()}</span
        >
        <Segmented
          options={frequencyOptions}
          bind:value={draft.frequency}
          label={m.recurrence_frequency()}
        />
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="rec-interval"
          label={m.recurrence_interval()}
          error={errors.interval}
        >
          {#snippet children({ describedby, invalid })}
            <div class="flex items-center gap-2">
              <span class="text-sm" aria-hidden="true"
                >{m.recurrence_every()}</span
              >
              <Input
                id="rec-interval"
                class="h-10 w-20 text-end tabular-nums"
                type="text"
                inputmode="numeric"
                maxlength={2}
                autocomplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
                bind:value={draft.interval}
              />
              <span class="text-sm" aria-live="polite">{intervalUnit}</span>
            </div>
          {/snippet}
        </Field>
        <Field
          id="rec-day"
          label={m.recurrence_day()}
          hint={m.recurrence_day_hint()}
          error={errors.dayOfMonth}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="rec-day"
              class="h-10 w-24 text-end tabular-nums"
              type="text"
              inputmode="numeric"
              maxlength={2}
              autocomplete="off"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.dayOfMonth}
              oninput={() => (draft.dayTouched = true)}
            />
          {/snippet}
        </Field>
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="rec-start"
          label={m.recurrence_start()}
          hint={m.recurrence_start_hint()}
          error={errors.startDate}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="rec-start"
              class="h-10"
              type="date"
              required
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              value={draft.startDate}
              oninput={(event) =>
                (draft = withStartDate(draft, event.currentTarget.value))}
            />
          {/snippet}
        </Field>
        <Field
          id="rec-end"
          label={m.recurrence_end()}
          optional
          hint={m.recurrence_end_hint()}
          error={errors.endDate}
        >
          {#snippet children({ describedby, invalid })}
            <div class="flex items-center gap-2">
              <Input
                id="rec-end"
                class="h-10 min-w-0 flex-1"
                type="date"
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
                bind:value={draft.endDate}
              />
              {#if draft.endDate}
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label={m.recurrence_end_none()}
                  title={m.recurrence_end_none()}
                  onclick={() => (draft.endDate = "")}
                >
                  <XIcon />
                </Button>
              {/if}
            </div>
          {/snippet}
        </Field>
      </div>

      <RecurrencePreview
        {rule}
        {today}
        lastBooked={recurrence?.lastOccurrenceDate ?? null}
        {booking}
        {ruleHint}
      />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.cost_form_payment()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="rec-payer"
          label={m.cost_paid_by()}
          hint={showPayerHint ? m.cost_payer_missing_hint() : undefined}
          error={errors.paidByUserId}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="rec-payer"
              bind:value={draft.paidByUserId}
              options={payerOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="rec-payee"
          label={m.cost_payee()}
          optional
          error={errors.payee}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="rec-payee"
              class="h-10"
              maxlength={200}
              autocomplete="off"
              placeholder={m.cost_payee_placeholder()}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.payee}
            />
          {/snippet}
        </Field>
      </div>

      <SplitEditor
        id="rec-split"
        bind:mode={draft.splitMode}
        bind:shares={draft.shares}
        bind:participants={draft.participants}
        {people}
        amountMinor={amount.ok ? amount.amountMinor : undefined}
        currency={draft.currency}
        error={errors.shares}
        participantsError={errors.participantIds}
        onmodechange={() => (draft.splitTouched = true)}
      />

      <SwitchField
        id="rec-counts"
        bind:checked={draft.countsAsExpense}
        label={m.cost_counts_as_expense()}
        hint={m.cost_counts_as_expense_hint()}
        onchange={() => (draft.countsTouched = true)}
      />

      {#if taxApplies}
        <Field
          id="rec-deductible"
          label={m.cost_deductible()}
          hint={m.cost_deductible_hint()}
          error={errors.deductible}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="rec-deductible"
              bind:value={draft.deductible}
              options={deductibleOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.cost_form_links()}</Card.Title>
      <Card.Description>{m.cost_form_links_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-5 sm:grid-cols-2">
      <Field id="rec-asset" label={m.cost_asset()} error={errors.assetId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="rec-asset"
            bind:value={draft.assetId}
            options={assetOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="rec-room" label={m.cost_room()} error={errors.roomId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="rec-room"
            bind:value={draft.roomId}
            options={roomOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <div
    class="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-8 md:px-8"
  >
    <FormAlert message={formError} />
    <div class="flex justify-end gap-2">
      <Button
        href={cancelHref}
        variant="outline"
        size="lg"
        class={cn(
          "flex-1 sm:flex-none",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="submit"
        size="lg"
        class="flex-1 sm:flex-none"
        disabled={pending}
      >
        {#if pending}
          <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
        {:else if recurrence}
          {m.common_save()}
        {:else}
          {m.common_create()}
        {/if}
      </Button>
    </div>
  </div>
</form>
