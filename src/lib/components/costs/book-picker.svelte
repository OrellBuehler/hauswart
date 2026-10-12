<script lang="ts">
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Label } from "$lib/components/ui/label/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    books,
    value = $bindable(""),
    label = m.cost_book(),
    hint,
    error,
    disabled = false,
    class: className,
    onchange,
  }: {
    id: string;
    /** The books to choose from; a book that is archived is labelled as such. */
    books: CostBook[];
    value?: string;
    label?: string;
    hint?: string | undefined;
    error?: string | undefined;
    disabled?: boolean;
    class?: string;
    onchange?: (bookId: string) => void;
  } = $props();

  const options = $derived(
    books.map((book) => ({
      value: book.id,
      label: book.archivedAt
        ? m.cost_book_archived_option({ name: book.name })
        : book.name,
    })),
  );
  const describedby = $derived(
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined,
  );
</script>

<div class={cn("flex min-w-0 flex-col gap-2", className)}>
  {#if options.length <= 4}
    <span class="text-sm leading-none font-medium">{label}</span>
    <Segmented
      {options}
      bind:value
      {label}
      {disabled}
      onchange={(next) => onchange?.(next)}
    />
  {:else}
    <Label for={id}>{label}</Label>
    <OptionSelect
      {id}
      bind:value
      {options}
      {disabled}
      invalid={Boolean(error)}
      {describedby}
      onchange={(next) => onchange?.(next)}
    />
  {/if}
  {#if hint}
    <p id={`${id}-hint`} class="text-muted-foreground text-xs text-pretty">
      {hint}
    </p>
  {/if}
  {#if error}
    <p id={`${id}-error`} class="text-destructive text-xs text-pretty">
      {error}
    </p>
  {/if}
</div>
