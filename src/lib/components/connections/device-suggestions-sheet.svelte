<script lang="ts">
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import CheckIcon from "@lucide/svelte/icons/check";
  import EyeOffIcon from "@lucide/svelte/icons/eye-off";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MapPinIcon from "@lucide/svelte/icons/map-pin";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { ExternalDevice } from "$lib/connections/types";
  import type { Room } from "$lib/api/schemas/rooms";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { roomForArea } from "$lib/connections/areas";
  import { loadDismissed, saveDismissed } from "$lib/connections/dismissed";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    rooms,
    onadded,
  }: {
    open?: boolean;
    rooms: Room[];
    /** Called after an asset was created, to refresh the inventory behind the sheet. */
    onadded: () => Promise<void> | void;
  } = $props();

  let devices = $state<ExternalDevice[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let dismissed = $state<string[]>([]);
  let showDismissed = $state(false);
  let q = $state("");
  let busy = $state<Record<string, boolean>>({});
  let rowError = $state<Record<string, string>>({});
  let sequence = 0;

  async function load() {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    try {
      const result = await api.call(endpoints.integrationsDevices, {
        params: { kind: "homeassistant" },
      });
      if (ticket !== sequence) return;
      devices = result.items;
    } catch (err) {
      if (ticket !== sequence) return;
      loadError = pickerErrorMessage(err);
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    dismissed = loadDismissed();
    showDismissed = false;
    q = "";
    rowError = {};
    void load();
  });

  const query = $derived(q.trim().toLowerCase());
  const matching = $derived(
    devices.filter(
      (d) =>
        !query ||
        [d.name, d.manufacturer, d.model, d.area]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
    ),
  );
  const visible = $derived(matching.filter((d) => !dismissed.includes(d.id)));
  const ignored = $derived(matching.filter((d) => dismissed.includes(d.id)));
  const ignoredTotal = $derived(
    devices.filter((d) => dismissed.includes(d.id)).length,
  );

  function details(device: ExternalDevice): string {
    return [device.manufacturer, device.model].filter(Boolean).join(" · ");
  }

  function dismiss(device: ExternalDevice) {
    dismissed = [...dismissed, device.id];
    saveDismissed(dismissed);
  }

  function restore(device: ExternalDevice) {
    dismissed = dismissed.filter((id) => id !== device.id);
    saveDismissed(dismissed);
  }

  async function adopt(device: ExternalDevice) {
    if (busy[device.id]) return;
    busy[device.id] = true;
    delete rowError[device.id];
    try {
      const room = roomForArea(device.area, rooms, device.areaId);
      const asset = await api.call(endpoints.assetsCreate, {
        body: {
          kind: "device",
          name: device.name.trim().slice(0, 120) || device.id,
          manufacturer: device.manufacturer?.trim().slice(0, 120) || null,
          model: device.model?.trim().slice(0, 120) || null,
          roomId: room?.id ?? null,
          externalSource: "homeassistant",
          externalRef: device.id,
        },
      });
      devices = devices.filter((d) => d.id !== device.id);
      toast.success(m.device_suggestions_adopted({ name: asset.name }));
      await onadded();
    } catch (err) {
      rowError[device.id] = pickerErrorMessage(err);
    } finally {
      busy[device.id] = false;
    }
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full gap-0 p-0 sm:max-w-md">
    <Sheet.Header class="border-b p-4 pe-12">
      <Sheet.Title>{m.device_suggestions_title()}</Sheet.Title>
      <Sheet.Description class="text-pretty">
        {m.device_suggestions_description()}
      </Sheet.Description>
    </Sheet.Header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if loading && devices.length === 0}
        <p
          class="text-muted-foreground flex items-center justify-center gap-2 px-4 py-12 text-sm"
          role="status"
        >
          <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
          {m.device_suggestions_loading()}
        </p>
      {:else if loadError}
        <div
          class="flex flex-col items-center gap-3 px-4 py-12 text-center"
          role="alert"
        >
          <p class="text-destructive text-sm text-pretty">{loadError}</p>
          <Button variant="outline" onclick={load}>{m.common_retry()}</Button>
        </div>
      {:else if devices.length === 0}
        <div class="p-4">
          <EmptyState
            icon={BoxesIcon}
            title={m.device_suggestions_empty_title()}
            description={m.device_suggestions_empty_body()}
          />
        </div>
      {:else}
        {#if devices.length > 6}
          <div class="relative border-b p-3">
            <SearchIcon
              class="text-muted-foreground pointer-events-none absolute start-6 top-1/2 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              class="h-10 ps-9"
              placeholder={m.device_suggestions_search()}
              aria-label={m.device_suggestions_search()}
              autocomplete="off"
              bind:value={q}
            />
          </div>
        {/if}

        {#if visible.length === 0}
          <p
            class="text-muted-foreground px-4 py-10 text-center text-sm text-pretty"
          >
            {query ? m.picker_no_match() : m.device_suggestions_all_handled()}
          </p>
        {:else}
          <ul class="divide-y" aria-label={m.device_suggestions_title()}>
            {#each visible as device (device.id)}
              {@const room = roomForArea(device.area, rooms, device.areaId)}
              <li class="flex flex-col gap-3 px-4 py-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <p class="font-medium break-words">{device.name}</p>
                  {#if details(device)}
                    <p class="text-muted-foreground text-xs break-words">
                      {details(device)}
                    </p>
                  {/if}
                  <p
                    class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs"
                  >
                    <MapPinIcon class="size-3.5 shrink-0" aria-hidden="true" />
                    {#if device.area}
                      <span>{device.area}</span>
                      <span aria-hidden="true">→</span>
                      <span class={room ? "text-foreground font-medium" : ""}>
                        {room ? room.name : m.device_suggestions_no_room()}
                      </span>
                    {:else}
                      <span>{m.device_suggestions_no_area()}</span>
                    {/if}
                  </p>
                </div>
                {#if rowError[device.id]}
                  <p class="text-destructive text-xs text-pretty" role="alert">
                    {rowError[device.id]}
                  </p>
                {/if}
                <div class="flex gap-2">
                  <Button
                    class="h-10 flex-1"
                    disabled={busy[device.id]}
                    aria-label={m.device_suggestions_adopt_aria({
                      name: device.name,
                    })}
                    onclick={() => adopt(device)}
                  >
                    {#if busy[device.id]}
                      <LoaderCircleIcon
                        class="animate-spin"
                      />{m.common_creating()}
                    {:else}
                      <CheckIcon />{m.device_suggestions_adopt()}
                    {/if}
                  </Button>
                  <Button
                    variant="outline"
                    class="h-10"
                    disabled={busy[device.id]}
                    aria-label={m.device_suggestions_ignore_aria({
                      name: device.name,
                    })}
                    onclick={() => dismiss(device)}
                  >
                    <EyeOffIcon />{m.device_suggestions_ignore()}
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if ignoredTotal > 0}
          <div class="border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              class="text-muted-foreground h-9"
              aria-expanded={showDismissed}
              onclick={() => (showDismissed = !showDismissed)}
            >
              {m.device_suggestions_ignored({ count: ignoredTotal })}
            </Button>
            {#if showDismissed}
              <ul class="mt-2 divide-y rounded-lg border">
                {#each ignored as device (device.id)}
                  <li class="flex items-center justify-between gap-3 px-3 py-2">
                    <span class="min-w-0 text-sm break-words"
                      >{device.name}</span
                    >
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-9 shrink-0"
                      aria-label={m.device_suggestions_restore_aria({
                        name: device.name,
                      })}
                      onclick={() => restore(device)}
                    >
                      <RotateCcwIcon />{m.device_suggestions_restore()}
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="text-muted-foreground mt-2 text-xs text-pretty">
              {m.device_suggestions_local_note()}
            </p>
          </div>
        {/if}
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
