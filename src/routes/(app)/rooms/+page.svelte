<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import DoorOpenIcon from "@lucide/svelte/icons/door-open";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Room } from "$lib/api/schemas/rooms";
  import { roomIconFor } from "$lib/assets/room-icons";
  import { roomStats } from "$lib/assets/tasks";
  import RoomFormDialog from "$lib/components/assets/room-form-dialog.svelte";
  import AreaImportDialog from "$lib/components/connections/area-import-dialog.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let reordered = $state<Room[] | null>(null);
  let moving = $state(false);
  let formOpen = $state(false);
  let importOpen = $state(false);
  let editing = $state<Room | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<Room | undefined>();

  const sorted = $derived(
    [...data.rooms].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
  );
  const rooms = $derived(reordered ?? sorted);
  const stats = $derived(roomStats(data.assets, data.tasks));
  const nextSortOrder = $derived(
    data.rooms.reduce((max, room) => Math.max(max, room.sortOrder + 1), 0),
  );

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(room: Room) {
    editing = room;
    formOpen = true;
  }

  function askDelete(room: Room) {
    deleting = room;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    const { id, name } = deleting;
    await api.call(endpoints.roomsDelete, { params: { id } });
    toast.success(m.rooms_deleted_toast({ name }));
    await invalidateAll();
  }

  async function move(index: number, delta: -1 | 1) {
    const next = [...rooms];
    const [room] = next.splice(index, 1);
    next.splice(index + delta, 0, room);
    reordered = next;
    moving = true;
    try {
      await Promise.all(
        next.flatMap((item, position) =>
          item.sortOrder === position
            ? []
            : [
                api.call(endpoints.roomsUpdate, {
                  params: { id: item.id },
                  body: { sortOrder: position },
                }),
              ],
        ),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      reordered = null;
      moving = false;
    }
  }
</script>

<svelte:head>
  <title>{m.nav_rooms()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_rooms()} description={m.rooms_description()}>
    {#snippet actions()}
      {#if data.areasAvailable}
        <Button variant="outline" onclick={() => (importOpen = true)}>
          <DownloadIcon />{m.rooms_import_ha()}
        </Button>
      {/if}
      <Button onclick={openCreate}><PlusIcon />{m.rooms_create()}</Button>
    {/snippet}
  </PageHeader>

  {#if rooms.length === 0}
    <EmptyState
      icon={DoorOpenIcon}
      title={m.rooms_empty_title()}
      description={m.rooms_empty_body()}
    >
      {#snippet actions()}
        {#if data.areasAvailable}
          <Button variant="outline" onclick={() => (importOpen = true)}>
            <DownloadIcon />{m.rooms_import_ha()}
          </Button>
        {/if}
        <Button onclick={openCreate}><PlusIcon />{m.rooms_create()}</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each rooms as room, index (room.id)}
        {@const Icon = roomIconFor(room.icon)}
        {@const count = stats.get(room.id)}
        <li
          class="bg-card hover:border-foreground/20 shadow-card relative flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors"
        >
          <span
            class="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-lg"
            aria-hidden="true"
          >
            <Icon class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <a
              href={resolve(`/rooms/${room.id}`)}
              class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 block truncate rounded-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px]"
            >
              {room.name}
            </a>
            <p
              class="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs"
            >
              <span>{m.rooms_count_assets({ count: count?.assets ?? 0 })}</span>
              {#if count?.actionable}
                <span
                  class={count.overdue
                    ? "text-destructive font-medium"
                    : "text-warning font-medium"}
                >
                  {m.rooms_count_tasks({ count: count.actionable })}
                </span>
              {/if}
            </p>
          </div>
          <div class="relative z-10 shrink-0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-lg"
                    aria-label={m.rooms_actions({ name: room.name })}
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onclick={() => openEdit(room)}>
                  <PencilIcon />{m.common_edit()}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={index === 0 || moving}
                  onclick={() => move(index, -1)}
                >
                  <ArrowUpIcon />{m.rooms_move_up_item()}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={index === rooms.length - 1 || moving}
                  onclick={() => move(index, 1)}
                >
                  <ArrowDownIcon />{m.rooms_move_down_item()}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  variant="destructive"
                  onclick={() => askDelete(room)}
                >
                  <Trash2Icon />{m.common_delete()}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<RoomFormDialog
  bind:open={formOpen}
  room={editing}
  {nextSortOrder}
  onsaved={invalidateAll}
/>

{#if data.areasAvailable}
  <AreaImportDialog
    bind:open={importOpen}
    rooms={data.rooms}
    onimported={invalidateAll}
  />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.rooms_delete_title()}
  description={m.rooms_delete_description({ name: deleting?.name ?? "" })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
