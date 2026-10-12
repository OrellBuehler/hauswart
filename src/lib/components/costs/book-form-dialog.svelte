<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    COST_BOOK_SPLIT_MODES,
    type CostBookSplitMode,
  } from "$lib/api/enums";
  import { isApiError } from "$lib/api/errors";
  import { endpoints } from "$lib/api/registry";
  import {
    COST_BOOK_NAME_MAX,
    type CostBook,
    type UpdateCostBookRequest,
  } from "$lib/api/schemas/cost-books";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { bookIconNames, bookIcons } from "$lib/costs/books";
  import { splitModeLabels } from "$lib/costs/labels";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    book,
    onsaved,
  }: {
    open?: boolean;
    /** The book to edit; undefined creates a new one. */
    book: CostBook | undefined;
    /** Runs after the book was saved (the dialog is already closing). */
    onsaved: (saved: CostBook) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let icon = $state<string | null>(null);
  let defaultSplitMode = $state<CostBookSplitMode>("ownership");
  let taxRelevant = $state(false);
  let errors = $state<Record<string, string>>({});

  const editing = $derived(book !== undefined);
  const splitHints: Record<CostBookSplitMode, () => string> = {
    ownership: () => m.costbook_split_ownership_hint(),
    equal: () => m.costbook_split_equal_hint(),
    none: () => m.costbook_split_none_hint(),
  };
  const splitOptions = $derived(
    COST_BOOK_SPLIT_MODES.map((value) => ({
      value,
      label: splitModeLabels[value](),
    })),
  );

  $effect(() => {
    if (!open) return;
    name = book?.name ?? "";
    icon = book?.icon ?? null;
    defaultSplitMode = book?.defaultSplitMode ?? "ownership";
    taxRelevant = book?.taxRelevant ?? false;
    errors = {};
  });

  async function submit(): Promise<string | void> {
    errors = {};
    const trimmed = name.trim();
    if (!trimmed) {
      errors.name = m.field_required();
      return m.form_check_fields();
    }
    try {
      let saved: CostBook;
      if (book) {
        const patch: UpdateCostBookRequest = {};
        if (trimmed !== book.name) patch.name = trimmed;
        if (icon !== book.icon) patch.icon = icon;
        if (defaultSplitMode !== book.defaultSplitMode) {
          patch.defaultSplitMode = defaultSplitMode;
        }
        if (taxRelevant !== book.taxRelevant) patch.taxRelevant = taxRelevant;
        if (Object.keys(patch).length === 0) return;
        saved = await api.call(endpoints.costBooksUpdate, {
          params: { id: book.id },
          body: patch,
        });
        toast.success(m.costbook_saved_toast({ name: saved.name }));
      } else {
        saved = await api.call(endpoints.costBooksCreate, {
          body: { name: trimmed, icon, defaultSplitMode, taxRelevant },
        });
        toast.success(m.costbook_created_toast({ name: saved.name }));
      }
      await onsaved(saved);
    } catch (err) {
      if (isApiError(err) && err.code === "conflict") {
        errors.name = m.costbook_error_name_taken();
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      throw err;
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.costbook_edit_title() : m.costbook_create_title()}
  description={editing
    ? m.costbook_edit_description()
    : m.costbook_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  onsubmit={submit}
  class="sm:max-w-lg"
>
  <Field id="costbook-name" label={m.costbook_name()} error={errors.name}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="costbook-name"
        class="h-10"
        autocomplete="off"
        required
        maxlength={COST_BOOK_NAME_MAX}
        placeholder={m.costbook_name_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={name}
      />
    {/snippet}
  </Field>

  <fieldset class="flex min-w-0 flex-col gap-2">
    <legend class="mb-1 text-sm leading-none font-medium">
      {m.costbook_icon()}
    </legend>
    <div
      role="radiogroup"
      aria-label={m.costbook_icon()}
      class="grid grid-cols-6 gap-1.5"
    >
      {#each bookIconNames as iconName (iconName)}
        {@const entry = bookIcons[iconName]}
        {@const selected = icon === iconName}
        {#if entry}
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={entry.label()}
            title={entry.label()}
            class={cn(
              "text-muted-foreground hover:bg-accent focus-visible:ring-ring/50 flex aspect-square items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-[3px]",
              selected &&
                "border-brand bg-brand/10 text-brand hover:bg-brand/15",
            )}
            onclick={() => (icon = selected ? null : iconName)}
          >
            <entry.icon class="size-5" aria-hidden="true" />
          </button>
        {/if}
      {/each}
    </div>
  </fieldset>

  <div class="flex min-w-0 flex-col gap-2">
    <span class="text-sm leading-none font-medium"
      >{m.costbook_default_split()}</span
    >
    <Segmented
      options={splitOptions}
      bind:value={defaultSplitMode}
      label={m.costbook_default_split()}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {m.costbook_default_split_hint()}
      {splitHints[defaultSplitMode]()}
    </p>
  </div>

  <SwitchField
    id="costbook-tax"
    bind:checked={taxRelevant}
    label={m.costbook_tax_relevant()}
    hint={m.costbook_tax_relevant_hint()}
  />
</FormDialog>
