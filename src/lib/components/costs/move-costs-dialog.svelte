<script lang="ts">
  import InfoIcon from "@lucide/svelte/icons/info";
  import { untrack } from "svelte";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import type {
    CostEntry,
    MoveCostsToBookResult,
  } from "$lib/api/schemas/costs";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import { openBooks } from "$lib/costs/books";
  import {
    moveFailure,
    moveRequest,
    suggestedTarget,
    taxClassLost,
    type MoveTarget,
  } from "$lib/costs/move";
  import { m } from "$lib/paraglide/messages";
  import BookPicker from "./book-picker.svelte";

  let {
    open = $bindable(false),
    books,
    target,
    entries = [],
    assetName,
    onmoved,
  }: {
    open?: boolean;
    /** Every cost book; the entries go to one that takes entries. */
    books: CostBook[];
    /** The entries picked in the list, or every entry of a device. */
    target: MoveTarget | undefined;
    /** The entries picked, to start from another book than theirs and to say whose tax class is reset. */
    entries?: CostEntry[];
    /** The device when the target is all of its entries. */
    assetName?: string | undefined;
    /** Runs after the entries were moved (the dialog is already closing). */
    onmoved: (
      result: MoveCostsToBookResult,
      bookName: string,
    ) => void | Promise<void>;
  } = $props();

  let bookId = $state("");
  let errors = $state<Record<string, string>>({});

  const choices = $derived(openBooks(books));
  const chosen = $derived(books.find((book) => book.id === bookId));
  const lost = $derived(taxClassLost(entries, chosen));
  const onAsset = $derived(target !== undefined && "assetId" in target);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      bookId = suggestedTarget(books, entries);
      errors = {};
    });
  });

  async function submit(): Promise<string | void> {
    errors = {};
    if (!target || !chosen) return m.form_check_fields();
    let result: MoveCostsToBookResult;
    try {
      result = await api.call(endpoints.costsMoveToBook, {
        body: moveRequest(chosen.id, target),
      });
    } catch (err) {
      const failure = moveFailure(err);
      if (failure.field) errors = { [failure.field]: failure.message };
      return failure.message;
    }
    await onmoved(result, chosen.name);
  }
</script>

<FormDialog
  bind:open
  title={m.costs_move_title()}
  description={onAsset
    ? m.costs_move_description_asset({ name: assetName ?? "" })
    : m.costs_move_description_ids({ count: entries.length })}
  submitLabel={m.costs_move_submit()}
  pendingLabel={m.costs_move_pending()}
  onsubmit={submit}
  class="sm:max-w-md"
>
  <BookPicker
    id="move-book"
    compact
    books={choices}
    bind:value={bookId}
    label={m.costs_move_to()}
    error={errors.bookId}
  />
  {#if chosen && !chosen.taxRelevant && (onAsset || lost > 0)}
    <p class="text-muted-foreground flex items-start gap-2 text-sm text-pretty">
      <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span
        >{onAsset
          ? m.costs_move_tax_asset()
          : m.costs_move_tax_ids({ count: lost })}</span
      >
    </p>
  {/if}
</FormDialog>
