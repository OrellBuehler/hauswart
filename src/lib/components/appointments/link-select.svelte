<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  type Item = { value: string; label: string; detail?: string | null };

  let {
    id,
    value = $bindable(null),
    items,
    noneLabel,
    fallbackLabel = null,
    loading = false,
    invalid = false,
    describedby,
    onchange,
    class: className,
  }: {
    id: string;
    /** The id of the chosen record, or null for none. */
    value?: string | null;
    items: Item[];
    /** The entry that clears the choice, and what the field says while nothing is chosen. */
    noneLabel: string;
    /** The name of the chosen record while it is not in `items` (archived, or the list is still loading). */
    fallbackLabel?: string | null;
    loading?: boolean;
    invalid?: boolean;
    describedby?: string | undefined;
    onchange?: (value: string | null) => void;
    class?: string;
  } = $props();

  let open = $state(false);
  let search = $state("");

  const query = $derived(search.trim().toLowerCase());
  const shown = $derived(
    query
      ? items.filter((item) =>
          `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(query),
        )
      : items,
  );
  const chosen = $derived(
    value === null ? undefined : items.find((item) => item.value === value),
  );
  const chosenLabel = $derived(
    value === null ? null : (chosen?.label ?? fallbackLabel),
  );

  $effect(() => {
    if (open) search = "";
  });

  function pick(next: string | null) {
    value = next;
    open = false;
    onchange?.(next);
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    {id}
    type="button"
    role="combobox"
    aria-expanded={open}
    aria-haspopup="listbox"
    aria-invalid={invalid || undefined}
    aria-describedby={describedby}
    class={cn(
      "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] md:text-sm",
      invalid &&
        "border-destructive ring-destructive/20 dark:ring-destructive/40",
      className,
    )}
  >
    {#if value !== null && chosenLabel}
      <span class="min-w-0 truncate">{chosenLabel}</span>
    {:else if value !== null && loading}
      <span class="text-muted-foreground truncate">{m.common_loading()}</span>
    {:else if value !== null}
      <span class="text-muted-foreground truncate"
        >{m.picker_unknown_item({ id: value })}</span
      >
    {:else}
      <span class="text-muted-foreground truncate">{noneLabel}</span>
    {/if}
    {#if loading}
      <LoaderCircleIcon
        class="size-4 shrink-0 animate-spin opacity-50"
        aria-hidden="true"
      />
    {:else}
      <ChevronsUpDownIcon
        class="size-4 shrink-0 opacity-50"
        aria-hidden="true"
      />
    {/if}
  </Popover.Trigger>
  <Popover.Content
    align="start"
    class="w-(--bits-popover-anchor-width) min-w-[min(20rem,calc(100vw-2rem))] p-0"
  >
    <Command.Root shouldFilter={false} class="rounded-md">
      <Command.Input
        bind:value={search}
        placeholder={m.picker_search()}
        aria-label={m.picker_search()}
        autocomplete="off"
        enterkeyhint="search"
      />
      <Command.List>
        {#if !query}
          <Command.Group>
            <Command.Item
              value="__none"
              class="text-muted-foreground"
              onSelect={() => pick(null)}
            >
              <span class="min-w-0 flex-1 truncate">{noneLabel}</span>
              {#if value === null}
                <CheckIcon aria-hidden="true" />
              {/if}
            </Command.Item>
          </Command.Group>
        {/if}
        {#if shown.length === 0}
          <p class="text-muted-foreground py-6 text-center text-sm">
            {items.length === 0
              ? m.appointment_link_none_yet()
              : m.picker_no_match()}
          </p>
        {:else}
          <Command.Group>
            {#each shown as item (item.value)}
              <Command.Item
                value={item.value}
                class="items-start"
                onSelect={() => pick(item.value)}
              >
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-medium">{item.label}</span>
                  {#if item.detail}
                    <span class="text-muted-foreground truncate text-xs"
                      >{item.detail}</span
                    >
                  {/if}
                </span>
                {#if item.value === value}
                  <CheckIcon class="mt-0.5" aria-hidden="true" />
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
