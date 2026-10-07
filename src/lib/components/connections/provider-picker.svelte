<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import XIcon from "@lucide/svelte/icons/x";
  import type { DocumentProviderKind } from "$lib/api/enums";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import {
    fetchPickerItems,
    loadAllPickerItems,
    type PickerItem,
    type PickerSource,
  } from "$lib/connections/provider-lists";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    kind,
    source,
    value = $bindable([]),
    max = 50,
    placeholder,
    searchPlaceholder,
    filter,
    disabled = false,
    invalid = false,
    describedby,
    onlisterror,
  }: {
    id: string;
    kind: DocumentProviderKind;
    source: PickerSource;
    /** The chosen ids. With `max` 1 this is a single choice. */
    value?: number[];
    max?: number;
    placeholder: string;
    searchPlaceholder: string;
    /** Offers only some of the entries (the date fields among the custom fields). */
    filter?: (item: PickerItem) => boolean;
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string | undefined;
    /**
     * Reports whether the list could be read (a message) or not (undefined). A form with many pickers
     * uses it to show one error for all of them; without it the picker shows its own.
     */
    onlisterror?: (id: string, message: string | undefined) => void;
  } = $props();

  const single = $derived(max === 1);

  /** Every entry of the list, to put names to the chosen ids. */
  let known = $state.raw(new Map<number, PickerItem>());
  let knownError = $state<string | undefined>();
  let knownLoading = $state(true);

  let open = $state(false);
  let search = $state("");
  let items = $state.raw<PickerItem[]>([]);
  let loading = $state(false);
  let error = $state<string | undefined>();
  let sequence = 0;

  async function loadKnown() {
    knownLoading = true;
    knownError = undefined;
    onlisterror?.(id, undefined);
    try {
      const list = await loadAllPickerItems(kind, source);
      known = new Map(list.map((item) => [item.id, item]));
    } catch (err) {
      knownError = pickerErrorMessage(err, kind);
      onlisterror?.(id, knownError);
    } finally {
      knownLoading = false;
    }
  }

  $effect(() => {
    void kind;
    void source;
    void loadKnown();
  });

  $effect(() => {
    if (!open) return;
    const q = search.trim();
    const ticket = ++sequence;
    loading = true;
    const handle = setTimeout(
      async () => {
        try {
          const result =
            q === ""
              ? await loadAllPickerItems(kind, source)
              : await fetchPickerItems(kind, source, q);
          if (ticket !== sequence) return;
          items = result;
          error = undefined;
        } catch (err) {
          if (ticket !== sequence) return;
          error = pickerErrorMessage(err, kind);
        } finally {
          if (ticket === sequence) loading = false;
        }
      },
      q === "" ? 0 : 250,
    );
    return () => clearTimeout(handle);
  });

  const shown = $derived(filter ? items.filter(filter) : items);
  const full = $derived(!single && value.length >= max);

  function nameOf(itemId: number): string {
    return known.get(itemId)?.name ?? m.picker_unknown_item({ id: itemId });
  }

  function toggle(item: PickerItem) {
    if (value.includes(item.id)) {
      value = value.filter((v) => v !== item.id);
    } else if (single) {
      value = [item.id];
      open = false;
    } else if (!full) {
      value = [...value, item.id];
    }
  }

  function remove(itemId: number) {
    value = value.filter((v) => v !== itemId);
  }

  function onOpenChange(next: boolean) {
    if (next) {
      search = "";
      error = undefined;
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-2">
  <div class="flex min-w-0 items-center gap-2">
    <Popover.Root bind:open {onOpenChange}>
      <Popover.Trigger
        {id}
        type="button"
        role="combobox"
        {disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class={cn(
          "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          invalid &&
            "border-destructive ring-destructive/20 dark:ring-destructive/40",
        )}
      >
        {#if single && value.length > 0}
          <span class="truncate">{nameOf(value[0] as number)}</span>
        {:else}
          <span class="text-muted-foreground truncate">{placeholder}</span>
        {/if}
        <ChevronsUpDownIcon
          class="size-4 shrink-0 opacity-50"
          aria-hidden="true"
        />
      </Popover.Trigger>
      <Popover.Content
        align="start"
        class="w-(--bits-popover-anchor-width) min-w-[min(16rem,calc(100vw-2rem))] p-0"
      >
        <Command.Root shouldFilter={false} class="rounded-md">
          <Command.Input
            bind:value={search}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autocapitalize="none"
            autocomplete="off"
            spellcheck={false}
          />
          <Command.List>
            {#if error}
              <div
                class="text-destructive flex items-start gap-2 px-3 py-3 text-sm text-pretty"
                role="alert"
              >
                <TriangleAlertIcon
                  class="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            {:else if loading && items.length === 0}
              <p
                class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm"
                role="status"
              >
                <LoaderCircleIcon
                  class="size-4 animate-spin"
                  aria-hidden="true"
                />
                {m.common_loading()}
              </p>
            {:else if shown.length === 0}
              <p class="text-muted-foreground py-6 text-center text-sm">
                {m.picker_no_match()}
              </p>
            {:else}
              <Command.Group>
                {#each shown as item (item.id)}
                  {@const selected = value.includes(item.id)}
                  <Command.Item
                    value={String(item.id)}
                    disabled={full && !selected}
                    onSelect={() => toggle(item)}
                  >
                    <CheckIcon
                      class={cn("size-4", !selected && "invisible")}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1 truncate">{item.name}</span>
                    {#if item.detail}
                      <span
                        class="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs"
                      >
                        {item.detail}
                      </span>
                    {/if}
                  </Command.Item>
                {/each}
              </Command.Group>
            {/if}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
    {#if single && value.length > 0 && !disabled}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shrink-0"
        aria-label={m.picker_clear()}
        onclick={() => (value = [])}
      >
        <XIcon />
      </Button>
    {/if}
  </div>

  {#if !single && value.length > 0}
    <ul class="flex flex-wrap gap-1.5" aria-label={m.picker_selected()}>
      {#each value as itemId (itemId)}
        {@const unknown = !known.has(itemId) && !knownLoading}
        <li class="max-w-full min-w-0">
          <Badge
            variant="secondary"
            class={cn(
              "h-7 max-w-full gap-1 ps-2.5 pe-1",
              unknown && "text-muted-foreground italic",
            )}
          >
            <span class="min-w-0 truncate">{nameOf(itemId)}</span>
            {#if !disabled}
              <button
                type="button"
                class="hover:bg-foreground/10 focus-visible:ring-ring/50 -me-0.5 flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
                aria-label={m.picker_remove({ name: nameOf(itemId) })}
                onclick={() => remove(itemId)}
              >
                <XIcon class="size-3" aria-hidden="true" />
              </button>
            {/if}
          </Badge>
        </li>
      {/each}
    </ul>
  {/if}

  {#if knownError && !onlisterror}
    <p class="text-destructive flex items-start gap-1.5 text-xs text-pretty">
      <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{knownError}</span>
      <button
        type="button"
        class="text-foreground shrink-0 underline underline-offset-2"
        onclick={loadKnown}
      >
        {m.common_retry()}
      </button>
    </p>
  {/if}
</div>
