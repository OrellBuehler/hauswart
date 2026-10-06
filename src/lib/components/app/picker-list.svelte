<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  type Item = { value: string; label: string; detail?: string | null };

  let {
    id,
    items,
    value = $bindable(""),
    label,
    placeholder,
    emptyText,
    class: className,
  }: {
    id: string;
    items: Item[];
    value?: string;
    label: string;
    placeholder?: string;
    emptyText: string;
    class?: string;
  } = $props();

  let q = $state("");

  const query = $derived(q.trim().toLowerCase());
  const shown = $derived(
    query
      ? items.filter((item) =>
          `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(query),
        )
      : items,
  );
</script>

<div class={cn("flex flex-col gap-2", className)}>
  {#if items.length > 6}
    <div class="relative">
      <SearchIcon
        class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        class="h-10 ps-9"
        placeholder={placeholder ?? m.picker_search()}
        aria-label={m.picker_search()}
        autocomplete="off"
        bind:value={q}
      />
    </div>
  {/if}
  <div
    {id}
    role="radiogroup"
    aria-label={label}
    class="max-h-56 overflow-y-auto rounded-lg border"
  >
    {#if shown.length === 0}
      <p class="text-muted-foreground px-3 py-6 text-center text-sm">
        {items.length === 0 ? emptyText : m.picker_no_match()}
      </p>
    {:else}
      <ul class="divide-y">
        {#each shown as item (item.value)}
          {@const selected = item.value === value}
          <li>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              class={cn(
                "hover:bg-accent/50 focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                selected && "bg-accent",
              )}
              onclick={() => (value = item.value)}
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">
                  {item.label}
                </span>
                {#if item.detail}
                  <span class="text-muted-foreground block truncate text-xs">
                    {item.detail}
                  </span>
                {/if}
              </span>
              {#if selected}
                <CheckIcon class="size-4 shrink-0" aria-hidden="true" />
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
