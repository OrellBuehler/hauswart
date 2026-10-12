<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { onMount, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import type { CostTag } from "$lib/api/schemas/cost-tags";
  import { COST_TITLE_MAX, type CostEntry } from "$lib/api/schemas/costs";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import { uploadErrorMessage } from "$lib/attachments/errors";
  import { uploadAttachment } from "$lib/attachments/upload";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    loadQuickBook,
    loadRememberedBook,
    rememberQuickBook,
  } from "$lib/costs/book-memory";
  import { bookIconFor, openBooks } from "$lib/costs/books";
  import { categoryIcons, categoryLabels } from "$lib/costs/labels";
  import { parseDraftAmount } from "$lib/costs/form";
  import { matchQuery, tieFailure, tieRefused } from "$lib/costs/matches";
  import {
    buildQuickCostBody,
    chipCategories,
    chooseQuickBook,
    cleanAmount,
    isKeyConflict,
    loadRecentCategories,
    needsMoreSection,
    newQuickDraft,
    quickErrorMessage,
    quickSplit,
    rankCategories,
    savedCostsQuery,
    splitSummary,
    withNotShared,
    withQuickBook,
    withTicked,
    type CategoryHistory,
    type QuickDraft,
  } from "$lib/costs/quick";
  import { addDays } from "$lib/dates";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatMoney } from "$lib/format-money";
  import { newIdempotencyKey } from "$lib/idempotency";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";
  import ChoiceChips from "./choice-chips.svelte";
  import FinanceMatches from "./finance-matches.svelte";
  import ReceiptPicker from "./receipt-picker.svelte";
  import TagPicker from "./tag-picker.svelte";

  let {
    books,
    people,
    assets,
    tags,
    financeConnected = false,
    currency,
    today,
    currentUserId,
    requestedBook,
  }: {
    /** Every cost book, archived ones included (only open ones are offered). */
    books: CostBook[];
    people: DirectoryUser[];
    assets: Asset[];
    /** Every cost tag; the chips only show when there are any (new tags are made in the full form). */
    tags: CostTag[];
    /** The person has a working finance connection: the form looks for bank transactions that fit the amount. */
    financeConnected?: boolean;
    /** The household's currency: a quick entry is always in it. */
    currency: string;
    today: string;
    currentUserId: string;
    /** The book the address names, if it does. */
    requestedBook: string | null;
  } = $props();

  /** Book chips up to this many open books, a select beyond. */
  const BOOK_CHIPS_MAX = 5;

  const userIds = untrack(() => people.map((p) => p.id));
  const names = untrack(
    () => new Map(people.map((p) => [p.id, p.displayName] as const)),
  );

  let draft = $state<QuickDraft>(
    untrack(() =>
      newQuickDraft({
        today,
        bookId: chooseQuickBook({ requested: requestedBook, books }),
        paidByUserId: people.some((p) => p.id === currentUserId)
          ? currentUserId
          : "",
        userIds,
        books,
      }),
    ),
  );
  /**
   * Names this draft's save. The same save sent again (a request that got no answer) returns the entry the first one
   * booked; a new key is taken after the entry is booked, and when the server says another entry has this one.
   */
  let idempotencyKey = $state(newIdempotencyKey());
  /** What the recent entries used, to rank the category chips; read after the page opened (see `onMount`). */
  let history = $state.raw<CategoryHistory[]>([]);
  let file = $state<File | null>(null);
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let busy = $state<"saving" | "attaching" | null>(null);
  let progress = $state(0);
  let moreCategories = $state(false);
  let moreOpen = $state(false);
  /** The entry is booked but its receipt did not arrive: the person decides what happens next. */
  let orphan = $state<{ cost: CostEntry; file: File; error: string } | null>(
    null,
  );
  let orphanBusy = $state<"retry" | "skip" | "undo" | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);
  let amountEl = $state<HTMLInputElement | null>(null);
  /** Counts up when the bank transactions are to be asked for again (the chosen one was refused). */
  let matchRefresh = $state(0);

  const open = $derived(openBooks(books));
  const book = $derived(books.find((b) => b.id === draft.bookId));
  const ranked = $derived(
    rankCategories(history, {
      bookId: draft.bookId,
      taxRelevant: book?.taxRelevant,
    }),
  );
  const categoryOptions = $derived(
    chipCategories(ranked, {
      selected: draft.category,
      expanded: moreCategories,
    }).map((value) => ({
      value,
      label: categoryLabels[value](),
      icon: categoryIcons[value],
    })),
  );
  const bookOptions = $derived(
    open.map((b) => ({
      value: b.id,
      label: b.name,
      icon: bookIconFor(b.icon),
    })),
  );
  const payerOptions = $derived(
    people.map((p) => ({
      value: p.id,
      label:
        p.id === currentUserId
          ? m.quick_you({ name: p.displayName })
          : p.displayName,
    })),
  );
  const whomOptions = $derived(
    people.map((p) => ({ value: p.id, label: p.displayName })),
  );
  const assetOptions = $derived([
    { value: "", label: m.cost_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const split = $derived(
    quickSplit(book, draft.participants, userIds, draft.notShared),
  );
  /** Nobody is ticked and that is a way of splitting (the book's, or the person's own), not an open question. */
  const notSharedOn = $derived(
    split.kind !== "unchosen" &&
      userIds.every((id) => !draft.participants.includes(id)),
  );
  const splitText = $derived(
    splitSummary(
      split,
      book,
      userIds
        .filter((id) => draft.participants.includes(id))
        .map((id) => names.get(id) ?? ""),
    ),
  );
  const amount = $derived(
    parseDraftAmount(cleanAmount(draft.amount), false, currency),
  );
  const matchFor = $derived(
    financeConnected
      ? matchQuery({
          amountMinor: amount.ok ? amount.amountMinor : undefined,
          currency,
          date: draft.date,
        })
      : null,
  );

  onMount(() => {
    amountEl?.focus();
    // The chips are in their fixed order until this arrives; once somebody picked a category they stay as they are.
    void loadRecentCategories(api).then((rows) => {
      if (draft.category === "") history = rows;
    });
    // The address did not name a book: the last quick entry's book, then the one the costs page showed last.
    if (requestedBook) return;
    const chosen = chooseQuickBook({
      lastUsed: loadQuickBook(currentUserId),
      remembered: loadRememberedBook(currentUserId),
      books,
    });
    if (chosen && chosen !== draft.bookId) {
      draft = withQuickBook(draft, chosen, books, userIds);
    }
  });

  /** A mistake that was pointed out goes away as soon as the person works on that field. */
  function clearError(field: string) {
    if (!(field in errors)) return;
    const rest = { ...errors };
    delete rest[field];
    errors = rest;
    if (Object.keys(rest).length === 0) formError = undefined;
  }
  $effect(() => {
    void draft.amount;
    untrack(() => clearError("amountMinor"));
  });
  $effect(() => {
    void draft.category;
    untrack(() => clearError("category"));
  });
  $effect(() => {
    void draft.date;
    untrack(() => clearError("date"));
  });
  $effect(() => {
    void draft.assetId;
    untrack(() => clearError("assetId"));
  });
  $effect(() => {
    void draft.title;
    untrack(() => clearError("title"));
  });
  $effect(() => {
    void draft.payee;
    untrack(() => clearError("payee"));
  });
  $effect(() => {
    if (split.kind !== "unchosen") untrack(() => clearError("participants"));
  });
  $effect(() => {
    void draft.tagIds;
    untrack(() => clearError("tagIds"));
  });
  $effect(() => {
    void draft.financeSuggestionId;
    untrack(() => clearError("financeSuggestionId"));
  });

  function pickBook(next: string) {
    draft = withQuickBook(draft, next, books, userIds);
  }

  function focusFirstError() {
    queueMicrotask(() => {
      if (needsMoreSection(errors)) moreOpen = true;
      queueMicrotask(() => {
        const invalid = formEl?.querySelector<HTMLElement>(
          "[aria-invalid='true']",
        );
        invalid?.scrollIntoView({ block: "center" });
        (invalid?.matches("input, button, select, textarea")
          ? invalid
          : invalid?.querySelector<HTMLElement>("button")
        )?.focus();
      });
    });
  }

  async function undo(saved: CostEntry) {
    try {
      await api.call(endpoints.costsDelete, { params: { id: saved.id } });
      toast.success(m.quick_undone_toast({ title: saved.title }));
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  /** The entry is booked (with its receipt, if there was one): say so, offer to undo it or add another, and show the list. */
  async function finish(saved: CostEntry, withoutReceipt = false) {
    toast.success(
      m.quick_saved_toast({
        title: saved.title,
        amount: formatMoney(saved.amountMinor, saved.currency),
      }),
      {
        description: withoutReceipt ? m.quick_saved_no_receipt() : undefined,
        duration: 10_000,
        action: { label: m.common_undo(), onClick: () => void undo(saved) },
        cancel: {
          label: m.quick_another(),
          onClick: () =>
            void goto(
              resolve(
                `/costs/quick?book=${encodeURIComponent(saved.bookId)}` as "/",
              ),
            ),
        },
      },
    );
    await goto(resolve(`/costs${savedCostsQuery(saved, today)}` as "/"), {
      invalidateAll: true,
    });
  }

  async function attach(saved: CostEntry, receipt: File) {
    busy = "attaching";
    progress = 0;
    try {
      await uploadAttachment(
        { file: receipt, ownerType: "cost", ownerId: saved.id },
        (fraction) => (progress = fraction),
      );
    } catch (err) {
      orphan = { cost: saved, file: receipt, error: uploadErrorMessage(err) };
      return;
    } finally {
      busy = null;
    }
    await finish(saved);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    formError = undefined;
    const built = buildQuickCostBody(draft, {
      currency,
      userIds,
      books,
      categoryLabel: (category) => categoryLabels[category](),
      idempotencyKey,
    });
    errors = built.errors;
    if (!built.body) {
      formError = m.form_check_fields();
      focusFirstError();
      return;
    }
    busy = "saving";
    const sentTie = draft.financeSuggestionId !== "";
    let saved: CostEntry;
    try {
      saved = await api.call(endpoints.costsCreate, { body: built.body });
    } catch (err) {
      errors = apiFieldErrors(err);
      formError = quickErrorMessage(err, "expense", {
        tiedToTransaction: sentTie,
      });
      if (tieRefused(err, sentTie)) {
        // The transaction was refused: let go of it and ask for the list again.
        draft.financeSuggestionId = "";
        matchRefresh += 1;
        const tie = isKeyConflict(err) ? undefined : tieFailure(err, sentTie);
        if (tie) {
          errors.financeSuggestionId = tie;
          formError = m.form_check_fields();
        }
      }
      // Only a key that stands for another entry is spent; for every other failure the same key is right for the retry.
      if (isKeyConflict(err)) idempotencyKey = newIdempotencyKey();
      busy = null;
      focusFirstError();
      return;
    }
    idempotencyKey = newIdempotencyKey();
    rememberQuickBook(currentUserId, saved.bookId);
    if (file) {
      await attach(saved, file);
      return;
    }
    busy = null;
    await finish(saved);
  }

  async function retryReceipt() {
    if (!orphan || orphanBusy) return;
    orphanBusy = "retry";
    const { cost, file: receipt } = orphan;
    orphan = null;
    try {
      await attach(cost, receipt);
    } finally {
      orphanBusy = null;
    }
  }

  async function skipReceipt() {
    if (!orphan || orphanBusy) return;
    orphanBusy = "skip";
    const { cost } = orphan;
    try {
      await finish(cost, true);
    } finally {
      orphanBusy = null;
    }
  }

  async function undoOrphan() {
    if (!orphan || orphanBusy) return;
    orphanBusy = "undo";
    const { cost } = orphan;
    try {
      await api.call(endpoints.costsDelete, { params: { id: cost.id } });
      orphan = null;
      formError = undefined;
      toast.success(m.quick_undone_toast({ title: cost.title }));
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      orphanBusy = null;
    }
  }

  const saveLabel = $derived(
    amount.ok
      ? m.quick_save_amount({
          amount: formatMoney(amount.amountMinor, currency),
        })
      : m.quick_save(),
  );
</script>

{#if orphan}
  <div class="flex flex-col gap-4" role="alert">
    <div
      class="border-destructive/40 bg-card flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 class="text-destructive text-base font-semibold">
        {m.quick_orphan_title()}
      </h2>
      <p class="text-sm text-pretty">
        {m.quick_orphan_body({
          title: orphan.cost.title,
          amount: formatMoney(orphan.cost.amountMinor, orphan.cost.currency),
        })}
      </p>
      <p class="text-destructive text-sm text-pretty">{orphan.error}</p>
      <div class="flex flex-col gap-2">
        <Button size="lg" disabled={orphanBusy !== null} onclick={retryReceipt}>
          {#if orphanBusy === "retry"}
            <LoaderCircleIcon class="animate-spin" />{m.quick_receipt_sending()}
          {:else}
            {m.common_retry()}
          {/if}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={orphanBusy !== null}
          onclick={skipReceipt}
        >
          {m.quick_orphan_skip()}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          disabled={orphanBusy !== null}
          onclick={undoOrphan}
        >
          {#if orphanBusy === "undo"}
            <LoaderCircleIcon class="animate-spin" />{m.common_deleting()}
          {:else}
            {m.quick_orphan_undo()}
          {/if}
        </Button>
      </div>
    </div>
  </div>
{:else}
  <form
    bind:this={formEl}
    class="flex flex-col gap-6"
    onsubmit={submit}
    novalidate
  >
    <Field id="quick-amount" label={m.cost_amount()} error={errors.amountMinor}>
      {#snippet children({ describedby, invalid })}
        <div class="relative">
          <span
            class="text-muted-foreground pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-lg font-medium"
            aria-hidden="true">{currency}</span
          >
          <Input
            id="quick-amount"
            bind:ref={amountEl}
            class="h-16 ps-18 pe-4 text-end text-3xl font-semibold tabular-nums md:text-3xl pointer-coarse:min-h-16"
            type="text"
            inputmode="decimal"
            enterkeyhint="done"
            autocomplete="off"
            placeholder="0.00"
            required
            disabled={busy !== null}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.amount}
          />
        </div>
      {/snippet}
    </Field>

    <FinanceMatches
      id="quick-matches"
      query={matchFor}
      bind:value={draft.financeSuggestionId}
      refresh={matchRefresh}
      disabled={busy !== null}
      error={errors.financeSuggestionId}
    />

    {#if open.length > 1}
      <div class="flex min-w-0 flex-col gap-2">
        <span id="quick-book-label" class="text-sm leading-none font-medium"
          >{m.cost_book()}</span
        >
        {#if open.length <= BOOK_CHIPS_MAX}
          <ChoiceChips
            options={bookOptions}
            label={m.cost_book()}
            bind:value={draft.bookId}
            disabled={busy !== null}
            onchange={(next) => pickBook(next as string)}
          />
        {:else}
          <OptionSelect
            id="quick-book"
            value={draft.bookId}
            options={bookOptions}
            onchange={pickBook}
          />
        {/if}
      </div>
    {/if}

    <div class="flex min-w-0 flex-col gap-2">
      <span id="quick-category-label" class="text-sm leading-none font-medium"
        >{m.cost_category()}</span
      >
      <ChoiceChips
        options={categoryOptions}
        label={m.cost_category()}
        bind:value={draft.category}
        invalid={Boolean(errors.category)}
        describedby={errors.category ? "quick-category-error" : undefined}
        disabled={busy !== null}
      />
      <div class="flex flex-wrap items-center justify-between gap-2">
        {#if errors.category}
          <p id="quick-category-error" class="text-destructive text-xs">
            {errors.category}
          </p>
        {:else}
          <span></span>
        {/if}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="pointer-coarse:h-10"
          aria-expanded={moreCategories}
          onclick={() => (moreCategories = !moreCategories)}
        >
          {moreCategories
            ? m.quick_categories_fewer()
            : m.quick_categories_more()}
        </Button>
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.quick_receipt_file()}
        <span class="text-muted-foreground font-normal"
          >({m.common_optional()})</span
        ></span
      >
      <ReceiptPicker id="quick-receipt" bind:file disabled={busy !== null} />
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-sm leading-none font-medium">{m.cost_paid_by()}</span>
      <ChoiceChips
        options={payerOptions}
        label={m.cost_paid_by()}
        bind:value={draft.paidByUserId}
        disabled={busy !== null}
      />
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-sm leading-none font-medium">{m.cost_for_whom()}</span>
      <ChoiceChips
        mode="multiple"
        options={whomOptions}
        label={m.cost_for_whom()}
        values={draft.participants}
        disabled={busy !== null}
        invalid={split.kind === "unchosen"}
        describedby="quick-whom-text"
        extra={{
          label: m.quick_split_not_shared(),
          on: notSharedOn,
          onselect: () => {
            if (!notSharedOn) draft = withNotShared(draft);
          },
        }}
        onchange={(next) => (draft = withTicked(draft, next as string[]))}
      />
      <p
        id="quick-whom-text"
        class={cn(
          "text-xs text-pretty",
          split.kind === "unchosen"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {splitText}
      </p>
    </div>

    {#if tags.length > 0}
      <TagPicker
        id="quick-tags"
        {tags}
        bind:value={draft.tagIds}
        disabled={busy !== null}
        error={errors.tagIds}
      />
    {/if}

    <Collapsible.Root bind:open={moreOpen} class="flex flex-col gap-5">
      <Collapsible.Trigger
        type="button"
        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-2 flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-[3px] [&[data-state=open]>svg]:rotate-180"
      >
        <ChevronDownIcon
          class="size-4 transition-transform motion-reduce:transition-none"
          aria-hidden="true"
        />
        {m.quick_more()}
      </Collapsible.Trigger>
      <Collapsible.Content class="flex flex-col gap-5">
        <Field id="quick-date" label={m.cost_date()} error={errors.date}>
          {#snippet children({ describedby, invalid })}
            <Input
              id="quick-date"
              class="h-11"
              type="date"
              required
              disabled={busy !== null}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.date}
            />
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="pointer-coarse:h-10"
                disabled={busy !== null || draft.date === today}
                onclick={() => (draft.date = today)}
              >
                {m.quick_today()}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="pointer-coarse:h-10"
                disabled={busy !== null || draft.date === addDays(today, -1)}
                onclick={() => (draft.date = addDays(today, -1))}
              >
                {m.quick_yesterday()}
              </Button>
            </div>
          {/snippet}
        </Field>
        <Field
          id="quick-payee"
          label={m.cost_payee()}
          optional
          error={errors.payee}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="quick-payee"
              class="h-11"
              maxlength={200}
              autocomplete="off"
              placeholder={m.cost_payee_placeholder()}
              disabled={busy !== null}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.payee}
            />
          {/snippet}
        </Field>
        <Field
          id="quick-title"
          label={m.cost_title()}
          optional
          hint={m.quick_title_hint()}
          error={errors.title}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="quick-title"
              class="h-11"
              maxlength={COST_TITLE_MAX}
              autocomplete="off"
              placeholder={m.cost_title_placeholder()}
              disabled={busy !== null}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.title}
            />
          {/snippet}
        </Field>
        <Field
          id="quick-asset"
          label={m.cost_asset()}
          optional
          error={errors.assetId}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="quick-asset"
              bind:value={draft.assetId}
              options={assetOptions}
              disabled={busy !== null}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </Collapsible.Content>
    </Collapsible.Root>

    <p class="text-muted-foreground text-sm text-pretty">
      <a
        href={resolve(
          `/costs/new${draft.bookId ? `?book=${encodeURIComponent(draft.bookId)}` : ""}` as "/",
        )}
        class="text-foreground focus-visible:ring-ring/50 rounded font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
        >{m.quick_full_form()}</a
      >
      {m.quick_full_form_hint()}
    </p>

    <div
      class={cn(
        "bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
        "md:mx-0 md:rounded-xl md:border md:pb-3",
      )}
    >
      <FormAlert message={formError} />
      <div class="flex gap-2">
        <Button
          href={resolve("/costs")}
          variant="outline"
          size="lg"
          class={cn(
            "h-12 shrink-0 pointer-coarse:h-12",
            busy !== null && "pointer-events-none opacity-50",
          )}
        >
          {m.common_cancel()}
        </Button>
        <Button
          type="submit"
          size="lg"
          class="h-12 min-w-0 flex-1 text-base pointer-coarse:h-12"
          disabled={busy !== null}
        >
          {#if busy === "saving"}
            <LoaderCircleIcon class="animate-spin" />{m.quick_saving()}
          {:else if busy === "attaching"}
            <LoaderCircleIcon class="animate-spin" />{m.quick_receipt_uploading(
              { percent: Math.round(progress * 100) },
            )}
          {:else}
            <span class="truncate">{saveLabel}</span>
          {/if}
        </Button>
      </div>
    </div>
  </form>
{/if}
