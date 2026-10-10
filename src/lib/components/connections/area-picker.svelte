<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import * as Command from "$lib/components/ui/command/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { areaKey } from "$lib/connections/areas";
  import {
    homeAssistantOf,
    isUsable,
    loadIntegrations,
  } from "$lib/connections/connection";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import type { ExternalArea } from "$lib/connections/types";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    value = $bindable(""),
    roomId,
  }: {
    id: string;
    /** The stored area id; empty when the room is not linked. */
    value?: string;
    /** The room being edited, so that its own area is not offered as taken. */
    roomId?: string;
  } = $props();

  /** `null` while the connection is still being looked up. */
  let connected = $state<boolean | null>(null);
  let open = $state(false);
  let areas = $state<ExternalArea[]>([]);
  let loading = $state(false);
  let error = $state<string | undefined>();
  let requested = false;

  $effect(() => {
    let cancelled = false;
    loadIntegrations().then(
      (list) => {
        if (!cancelled) connected = isUsable(homeAssistantOf(list));
      },
      (err) => {
        console.warn("integrations unavailable", err);
        if (!cancelled) connected = false;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  async function load() {
    loading = true;
    error = undefined;
    try {
      areas = (
        await api.call(endpoints.integrationsAreas, {
          params: { kind: "homeassistant" },
        })
      ).items;
    } catch (err) {
      error = pickerErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!connected || requested || !(open || value)) return;
    requested = true;
    void load();
  });

  const chosen = $derived(
    value ? areas.find((a) => areaKey(a.id) === areaKey(value)) : undefined,
  );
  const known = $derived(areas.length > 0 && !loading);

  function pick(next: string) {
    value = next;
    open = false;
  }
</script>

{#if connected}
  <div class="flex min-w-0 flex-col gap-1.5">
    <Popover.Root bind:open>
      <Popover.Trigger
        {id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        class="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] md:text-sm"
      >
        {#if value}
          <span class="flex min-w-0 flex-col leading-tight">
            {#if chosen}
              <span class="truncate">{chosen.name}</span>
              {#if chosen.floor}
                <span class="text-muted-foreground truncate text-[11px]">
                  {chosen.floor}
                </span>
              {/if}
            {:else if known}
              <span class="truncate">
                {m.rooms_ha_area_unknown({ id: value })}
              </span>
            {:else}
              <span class="truncate font-mono text-sm">{value}</span>
            {/if}
          </span>
        {:else}
          <span class="text-muted-foreground truncate">
            {m.rooms_ha_area_placeholder()}
          </span>
        {/if}
        <ChevronsUpDownIcon
          class="size-4 shrink-0 opacity-50"
          aria-hidden="true"
        />
      </Popover.Trigger>
      <Popover.Content
        align="start"
        class="w-(--bits-popover-anchor-width) min-w-[min(18rem,calc(100vw-3rem))] p-0"
      >
        <Command.Root class="rounded-md">
          <Command.Input
            placeholder={m.rooms_ha_area_search()}
            aria-label={m.rooms_ha_area_search()}
            autocapitalize="none"
            autocomplete="off"
            enterkeyhint="search"
            spellcheck={false}
          />
          <Command.List>
            {#if error}
              <div
                class="flex flex-col items-start gap-2 px-3 py-3 text-sm text-pretty"
                role="alert"
              >
                <p class="text-destructive flex items-start gap-2">
                  <TriangleAlertIcon
                    class="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{error}</span>
                </p>
                <Button variant="outline" size="sm" onclick={load}>
                  {m.common_retry()}
                </Button>
              </div>
            {:else if loading && areas.length === 0}
              <p
                class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm"
                role="status"
              >
                <LoaderCircleIcon
                  class="size-4 animate-spin"
                  aria-hidden="true"
                />
                {m.rooms_import_loading()}
              </p>
            {:else}
              <Command.Empty>
                {areas.length === 0
                  ? m.rooms_import_empty_title()
                  : m.picker_no_match()}
              </Command.Empty>
              <Command.Group>
                {#if value}
                  <Command.Item
                    value="__none"
                    forceMount
                    onSelect={() => pick("")}
                  >
                    <span class="min-w-0 flex-1 truncate">
                      {m.rooms_ha_area_none()}
                    </span>
                  </Command.Item>
                {/if}
                {#each areas as area (area.id)}
                  {@const taken =
                    area.roomId !== null && area.roomId !== roomId}
                  <Command.Item
                    value={area.id}
                    keywords={[area.name, area.floor ?? ""]}
                    class="items-start"
                    disabled={taken}
                    onSelect={() => pick(area.id)}
                  >
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="font-medium break-words">{area.name}</span>
                      {#if area.floor || taken}
                        <span
                          class="text-muted-foreground text-[11px] break-words"
                        >
                          {[area.floor, taken ? m.rooms_ha_area_taken() : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      {/if}
                    </span>
                    <CheckIcon
                      class={cn(
                        "mt-0.5",
                        chosen?.id === area.id ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  </Command.Item>
                {/each}
              </Command.Group>
            {/if}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
    <p class="text-muted-foreground text-xs text-pretty">
      {m.rooms_ha_area_hint_connected()}
    </p>
  </div>
{:else}
  <div class="flex min-w-0 flex-col gap-2">
    <Input
      {id}
      autocomplete="off"
      autocapitalize="none"
      spellcheck={false}
      maxlength={200}
      placeholder="wohnzimmer"
      bind:value
    />
    <p class="text-muted-foreground text-xs">{m.rooms_ha_area_hint()}</p>
  </div>
{/if}
