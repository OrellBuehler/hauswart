<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Settings2Icon from "@lucide/svelte/icons/settings-2";
  import { resolve } from "$app/paths";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import { bookIconFor, switcherBooks } from "$lib/costs/books";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    books,
    value,
    hrefFor,
    canWrite = false,
    oncreate,
    class: className,
  }: {
    books: CostBook[];
    /** The book on screen; empty for every book. */
    value: string;
    /** The address of the page for a book (`""` = every book). */
    hrefFor: (bookId: string) => string;
    /** Offers "new book" (with `oncreate`). */
    canWrite?: boolean;
    oncreate?: () => void;
    class?: string;
  } = $props();

  const shown = $derived(switcherBooks(books, value));

  let nav = $state<HTMLElement | null>(null);

  // On a phone the chips scroll: bring the book on screen into view.
  $effect(() => {
    void [value, shown.length];
    const current = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !current) return;
    const box = nav.getBoundingClientRect();
    const chip = current.getBoundingClientRect();
    nav.scrollLeft += chip.left - box.left - (box.width - chip.width) / 2;
  });

  const chip =
    "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11";
  const idle = "bg-card hover:bg-accent";
  const active = "border-brand bg-brand text-brand-foreground";
</script>

<nav
  bind:this={nav}
  aria-label={m.costbook_switcher_label()}
  class={cn(
    "-mx-4 [scrollbar-width:none] max-sm:overflow-x-auto sm:mx-0 [&::-webkit-scrollbar]:hidden",
    className,
  )}
>
  <ul
    class="flex items-center gap-2 px-4 max-sm:w-max max-sm:min-w-full sm:flex-wrap sm:px-0"
  >
    <li class="min-w-0 shrink-0 sm:shrink">
      <!-- eslint-disable svelte/no-navigation-without-resolve -- hrefFor resolves the address -->
      <a
        href={hrefFor("")}
        aria-current={value === "" ? "true" : undefined}
        class={cn(chip, value === "" ? active : idle)}
      >
        {m.costbook_all()}
      </a>
    </li>
    {#each shown as book (book.id)}
      {@const Icon = bookIconFor(book.icon)}
      {@const current = book.id === value}
      <li class="min-w-0 shrink-0 sm:shrink">
        <a
          href={hrefFor(book.id)}
          aria-current={current ? "true" : undefined}
          class={cn(chip, current ? active : idle)}
        >
          <Icon class="size-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{book.name}</span>
          {#if book.archivedAt}
            <span class="text-xs font-normal opacity-70"
              >{m.costbook_archived_badge()}</span
            >
          {/if}
        </a>
      </li>
    {/each}
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {#if canWrite && oncreate}
      <li class="shrink-0">
        <button
          type="button"
          class={cn(
            chip,
            "text-muted-foreground hover:bg-accent border-dashed",
          )}
          onclick={oncreate}
        >
          <PlusIcon class="size-4" aria-hidden="true" />
          {m.costbook_new()}
        </button>
      </li>
    {/if}
    <li class="shrink-0 sm:ms-auto">
      <a
        href={resolve("/settings/cost-books")}
        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
      >
        <Settings2Icon class="size-4" aria-hidden="true" />
        {m.costbook_manage()}
      </a>
    </li>
  </ul>
</nav>
