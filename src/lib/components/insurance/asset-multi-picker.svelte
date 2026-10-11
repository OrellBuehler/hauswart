<script lang="ts">
  import SearchIcon from "@lucide/svelte/icons/search";
  import { kindIcons } from "$lib/assets/kinds";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import type { PickerAsset } from "$lib/insurance/form";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    items,
    selected = $bindable([]),
    label,
    emptyText,
    class: className,
  }: {
    id: string;
    items: PickerAsset[];
    /** The ids of the chosen items. */
    selected?: string[];
    label: string;
    emptyText: string;
    class?: string;
  } = $props();

  let q = $state("");

  const query = $derived(q.trim().toLowerCase());
  const shown = $derived(
    query
      ? items.filter((item) =>
          `${item.name} ${item.roomName ?? ""}`.toLowerCase().includes(query),
        )
      : items,
  );

  function toggle(itemId: string, on: boolean) {
    selected = on
      ? [...selected.filter((value) => value !== itemId), itemId]
      : selected.filter((value) => value !== itemId);
  }
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
        placeholder={m.picker_search()}
        aria-label={m.picker_search()}
        autocomplete="off"
        bind:value={q}
      />
    </div>
  {/if}
  <div
    {id}
    role="group"
    aria-label={label}
    class="max-h-[min(16rem,40dvh)] overflow-y-auto rounded-lg border"
  >
    {#if shown.length === 0}
      <p
        class="text-muted-foreground px-3 py-6 text-center text-sm text-pretty"
      >
        {items.length === 0 ? emptyText : m.picker_no_match()}
      </p>
    {:else}
      <ul class="divide-y">
        {#each shown as item (item.id)}
          {@const Icon = kindIcons[item.kind]}
          <li>
            <Label
              class="hover:bg-accent/50 min-h-11 w-full cursor-pointer gap-3 px-3 py-2 leading-normal font-normal"
            >
              <Checkbox
                checked={selected.includes(item.id)}
                onCheckedChange={(on) => toggle(item.id, on)}
              />
              <Icon
                class="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium"
                  >{item.name}</span
                >
                {#if item.roomName}
                  <span class="text-muted-foreground block truncate text-xs"
                    >{item.roomName}</span
                  >
                {/if}
              </span>
            </Label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <p class="text-muted-foreground text-xs" aria-live="polite">
    {selected.length === 0
      ? m.insurance_assets_none()
      : m.insurance_assets_selected({ count: selected.length })}
  </p>
</div>
