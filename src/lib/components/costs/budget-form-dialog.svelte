<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { COST_BUDGET_PERIODS, COST_CATEGORIES } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import type { CostBudget } from "$lib/api/schemas/cost-budgets";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { bookChoices } from "$lib/costs/books";
  import {
    budgetPeriodLabels,
    budgetSaveErrors,
    buildBudgetCreateBody,
    buildBudgetUpdateBody,
    draftFromBudget,
    newBudgetDraft,
    type BudgetDraft,
  } from "$lib/costs/budgets";
  import { categoryLabels } from "$lib/costs/labels";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let {
    open = $bindable(false),
    budget,
    books,
    currency,
    defaultBookId,
    defaultPeriod,
    onsaved,
  }: {
    open?: boolean;
    /** The budget to change; undefined makes a new one. */
    budget: CostBudget | undefined;
    /** Every cost book; the budget may be for one that takes entries, or the one it has. */
    books: CostBook[];
    /** The household's currency: what a new budget is in. */
    currency: string;
    /** The book a new budget starts with. */
    defaultBookId?: string | undefined;
    defaultPeriod?: "month" | "year" | undefined;
    /** Runs after the budget was saved (the dialog is already closing). */
    onsaved: (saved: CostBudget) => void | Promise<void>;
  } = $props();

  let draft = $state<BudgetDraft>(newBudgetDraft({}));
  let errors = $state<Record<string, string>>({});

  const editing = $derived(budget !== undefined);
  const budgetCurrency = $derived(budget?.currency ?? currency);

  const bookOptions = $derived([
    { value: "", label: m.budget_all_books() },
    ...bookChoices(books, budget?.bookId).map((book) => ({
      value: book.id,
      label: book.archivedAt
        ? m.cost_book_archived_option({ name: book.name })
        : book.name,
    })),
  ]);
  const categoryOptions = $derived([
    { value: "", label: m.budget_all_categories() },
    ...COST_CATEGORIES.map((category) => ({
      value: category,
      label: categoryLabels[category](),
    })),
  ]);
  const periodOptions = $derived(
    COST_BUDGET_PERIODS.map((value) => ({
      value,
      label: budgetPeriodLabels[value](),
    })),
  );

  $effect(() => {
    if (!open) return;
    // A page that refreshes behind the open dialog must not reset what is typed.
    untrack(() => {
      draft = budget
        ? draftFromBudget(budget)
        : newBudgetDraft({
            bookId: defaultBookId,
            period: defaultPeriod,
          });
      errors = {};
    });
  });

  function scopeName(saved: CostBudget): string {
    const book = saved.bookName ?? m.budget_all_books();
    return saved.category
      ? `${categoryLabels[saved.category]()} · ${book}`
      : book;
  }

  async function submit(): Promise<string | void> {
    errors = {};
    const built = budget
      ? buildBudgetUpdateBody(draft, budget, currency)
      : buildBudgetCreateBody(draft, currency);
    if (!built.body) {
      errors = built.errors;
      return m.form_check_fields();
    }
    if (budget && Object.keys(built.body).length === 0) return;
    try {
      const saved = budget
        ? await api.call(endpoints.costBudgetsUpdate, {
            params: { id: budget.id },
            body: built.body as never,
          })
        : await api.call(endpoints.costBudgetsCreate, {
            body: built.body as never,
          });
      toast.success(
        budget
          ? m.budget_saved_toast({ name: scopeName(saved) })
          : m.budget_created_toast({ name: scopeName(saved) }),
      );
      await onsaved(saved);
    } catch (err) {
      const known = budgetSaveErrors(err);
      if (known) {
        errors = known;
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      throw err;
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.budget_edit_title() : m.budget_create_title()}
  description={editing
    ? m.budget_edit_description()
    : m.budget_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  onsubmit={submit}
  class="sm:max-w-lg"
>
  <div class="grid gap-5 sm:grid-cols-2">
    <Field
      id="budget-book"
      label={m.budget_book()}
      error={errors.bookId}
      hint={errors.bookId ? undefined : m.budget_scope_hint()}
      class="sm:col-span-2"
    >
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="budget-book"
          bind:value={draft.bookId}
          options={bookOptions}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
    <Field
      id="budget-category"
      label={m.budget_category()}
      error={errors.category}
      class="sm:col-span-2"
    >
      {#snippet children({ describedby, invalid })}
        <OptionSelect
          id="budget-category"
          value={draft.category}
          options={categoryOptions}
          onchange={(next) =>
            (draft.category = next as BudgetDraft["category"])}
          {invalid}
          {describedby}
        />
      {/snippet}
    </Field>
  </div>

  <div class="flex min-w-0 flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.budget_period()}</span>
    <Segmented
      options={periodOptions}
      bind:value={draft.period}
      label={m.budget_period()}
    />
    {#if errors.period}
      <p class="text-destructive text-xs">{errors.period}</p>
    {/if}
  </div>

  <Field
    id="budget-amount"
    label={m.budget_amount()}
    hint={m.budget_amount_hint({ currency: budgetCurrency })}
    error={errors.amountMinor}
  >
    {#snippet children({ describedby, invalid })}
      <div class="relative">
        <span
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm"
          aria-hidden="true">{budgetCurrency}</span
        >
        <Input
          id="budget-amount"
          class="h-10 ps-14 text-end tabular-nums"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0.00"
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          bind:value={draft.amount}
        />
      </div>
    {/snippet}
  </Field>

  {#if editing}
    <SwitchField
      id="budget-active"
      bind:checked={draft.active}
      label={m.budget_active()}
      hint={m.budget_active_hint()}
    />
  {/if}
</FormDialog>
