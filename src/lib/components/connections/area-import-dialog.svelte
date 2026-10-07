<script lang="ts">
  import HouseIcon from "@lucide/svelte/icons/house";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Room } from "$lib/api/schemas/rooms";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { matchAreaToRoom } from "$lib/connections/areas";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import type { ExternalArea } from "$lib/connections/types";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    rooms,
    onimported,
  }: {
    open?: boolean;
    rooms: Room[];
    /** Called after rooms were created or linked, to refresh the list behind the dialog. */
    onimported: () => Promise<void> | void;
  } = $props();

  let areas = $state<ExternalArea[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let selected = $state<string[]>([]);
  let pending = $state(false);
  let error = $state<string | undefined>();
  let sequence = 0;

  async function load() {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    try {
      const result = await api.call(endpoints.integrationsAreas, {
        params: { kind: "homeassistant" },
      });
      if (ticket !== sequence) return;
      areas = result.items;
      const present = new Set(result.items.map((a) => a.id));
      selected = selected.filter((id) => present.has(id));
    } catch (err) {
      if (ticket !== sequence) return;
      loadError = pickerErrorMessage(err);
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    selected = [];
    error = undefined;
    void load();
  });

  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name;

  const rows = $derived(
    areas.map((area) => {
      const linked = area.roomId !== null;
      const match = linked ? undefined : matchAreaToRoom(area, rooms, areas);
      return {
        area,
        linked,
        roomName: linked ? roomName(area.roomId) : undefined,
        sameName: match?.how === "name" ? match.room.name : undefined,
      };
    }),
  );
  const selectable = $derived(rows.filter((r) => !r.linked));
  const allSelected = $derived(
    selectable.length > 0 && selected.length === selectable.length,
  );

  function toggle(id: string, checked: boolean) {
    selected = checked
      ? [...selected.filter((s) => s !== id), id]
      : selected.filter((s) => s !== id);
  }

  async function submit() {
    if (pending || selected.length === 0) return;
    pending = true;
    error = undefined;
    try {
      const order = areas.map((a) => a.id);
      const result = await api.call(endpoints.roomsImportAreas, {
        body: {
          kind: "homeassistant",
          areaIds: order.filter((id) => selected.includes(id)),
        },
      });
      const created = result.items.filter((i) => i.outcome === "created");
      const linked = result.items.filter((i) => i.outcome === "linked");
      const gone = result.items.filter((i) => i.outcome === "not_found");
      const imported = created.length + linked.length;
      if (imported > 0) {
        toast.success(
          [
            m.rooms_import_done_toast({ count: imported }),
            linked.length > 0
              ? m.rooms_import_linked_note({ count: linked.length })
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        await onimported();
      } else if (gone.length === 0) {
        toast.info(m.rooms_import_nothing_new());
      }
      if (gone.length > 0) {
        error = m.rooms_import_gone({ count: gone.length });
        selected = [];
        await load();
      } else {
        open = false;
      }
    } catch (err) {
      error = pickerErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content
    class="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
  >
    <Dialog.Header class="border-b p-4 pe-12 sm:p-6 sm:pe-12">
      <Dialog.Title>{m.rooms_import_title()}</Dialog.Title>
      <Dialog.Description class="text-pretty">
        {m.rooms_import_description()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if loading && areas.length === 0}
        <p
          class="text-muted-foreground flex items-center justify-center gap-2 px-4 py-12 text-sm"
          role="status"
        >
          <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
          {m.rooms_import_loading()}
        </p>
      {:else if loadError}
        <div
          class="flex flex-col items-center gap-3 px-4 py-12 text-center"
          role="alert"
        >
          <p class="text-destructive text-sm text-pretty">{loadError}</p>
          <Button variant="outline" onclick={load}>{m.common_retry()}</Button>
        </div>
      {:else if areas.length === 0}
        <div class="p-4">
          <EmptyState
            icon={HouseIcon}
            title={m.rooms_import_empty_title()}
            description={m.rooms_import_empty_body()}
          />
        </div>
      {:else}
        <div
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2"
        >
          <p class="text-muted-foreground text-sm" aria-live="polite">
            {#if selectable.length === 0}
              {m.rooms_import_all_done()}
            {:else}
              {m.rooms_import_selected({
                selected: selected.length,
                total: selectable.length,
              })}
            {/if}
          </p>
          {#if selectable.length > 0}
            <Button
              variant="ghost"
              size="sm"
              class="h-9"
              disabled={pending}
              onclick={() =>
                (selected = allSelected
                  ? []
                  : selectable.map((r) => r.area.id))}
            >
              {allSelected
                ? m.rooms_import_select_none()
                : m.rooms_import_select_all()}
            </Button>
          {/if}
        </div>
        <ul class="divide-y" aria-label={m.rooms_import_list()}>
          {#each rows as row (row.area.id)}
            {@const checked = row.linked || selected.includes(row.area.id)}
            <li>
              <label
                class={cn(
                  "flex items-start gap-3 px-4 py-3",
                  row.linked
                    ? "cursor-default"
                    : "hover:bg-accent/50 cursor-pointer",
                )}
              >
                <Checkbox
                  class="mt-0.5"
                  {checked}
                  disabled={row.linked || pending}
                  onCheckedChange={(value) => toggle(row.area.id, value)}
                />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="font-medium break-words">{row.area.name}</span>
                  {#if row.area.floor}
                    <span class="text-muted-foreground text-xs break-words">
                      {row.area.floor}
                    </span>
                  {/if}
                  {#if row.linked && row.roomName}
                    <span class="text-muted-foreground text-xs break-words">
                      {m.rooms_import_as_room({ name: row.roomName })}
                    </span>
                  {:else if row.sameName}
                    <span class="text-foreground text-xs break-words">
                      {m.rooms_import_will_link({ name: row.sameName })}
                    </span>
                  {/if}
                </span>
                {#if row.linked}
                  <Badge variant="secondary"
                    >{m.rooms_import_done_badge()}</Badge
                  >
                {/if}
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="flex flex-col gap-3 border-t p-4 sm:p-6">
      <FormAlert message={error} />
      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button
          type="button"
          disabled={pending || selected.length === 0}
          onclick={submit}
        >
          {#if pending}
            <LoaderCircleIcon
              class="animate-spin"
            />{m.rooms_import_submitting()}
          {:else}
            {m.rooms_import_submit({ count: selected.length })}
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
