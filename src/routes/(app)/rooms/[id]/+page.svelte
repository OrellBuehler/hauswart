<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { resolve } from "$app/paths";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import QrCodeIcon from "@lucide/svelte/icons/qr-code";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { newAssetHref, roomTasksHref } from "$lib/assets/links";
  import { roomIconFor } from "$lib/assets/room-icons";
  import { sortTasks } from "$lib/assets/tasks";
  import AssetRow from "$lib/components/assets/asset-row.svelte";
  import RoomFormDialog from "$lib/components/assets/room-form-dialog.svelte";
  import TaskRows from "$lib/components/assets/task-rows.svelte";
  import LinkedDocsCard from "$lib/components/docs/linked-docs-card.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { docsFilterHref, newDocHref } from "$lib/docs/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let editOpen = $state(false);
  let deleteOpen = $state(false);

  const Icon = $derived(roomIconFor(data.room.icon));
  const assets = $derived(
    data.assets
      .filter((asset) => !asset.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const tasks = $derived(sortTasks(data.tasks));

  async function remove() {
    const { id, name } = data.room;
    await api.call(endpoints.roomsDelete, { params: { id } });
    toast.success(m.rooms_deleted_toast({ name }));
    await gotoFromOverlay(resolve("/rooms"));
  }
</script>

<svelte:head>
  <title>{data.room.name} · {m.nav_rooms()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/rooms")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{m.nav_rooms()}
    </Button>
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          <Icon class="size-6" />
        </span>
        <h1
          class="min-w-0 text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
        >
          {data.room.name}
        </h1>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          class="max-sm:hidden"
          onclick={() => (editOpen = true)}
        >
          <PencilIcon />{m.common_edit()}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon"
                aria-label={m.rooms_actions({ name: data.room.name })}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              class="sm:hidden"
              onclick={() => (editOpen = true)}
            >
              <PencilIcon />{m.common_edit()}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onclick={() => goto(resolve(`/rooms/${data.room.id}/qr`))}
            >
              <QrCodeIcon />{m.rooms_qr_sheet()}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => (deleteOpen = true)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>
    {#if data.room.notes}
      <p
        class="text-muted-foreground max-w-prose text-sm wrap-anywhere whitespace-pre-line"
      >
        {data.room.notes}
      </p>
    {/if}
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.rooms_assets_title()}</Card.Title>
      <Card.Action class="flex gap-2">
        <Button
          href={newAssetHref("device", data.room.id)}
          size="sm"
          variant="outline"
        >
          <PlusIcon />{m.rooms_add_asset()}
        </Button>
      </Card.Action>
    </Card.Header>
    <Card.Content>
      {#if assets.length === 0}
        <EmptyState
          icon={BoxesIcon}
          title={m.rooms_assets_empty_title()}
          description={m.rooms_assets_empty_body()}
          class="py-8"
        />
      {:else}
        <ul class="divide-y rounded-lg border">
          {#each assets as asset (asset.id)}
            <AssetRow {asset} today={data.today} />
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.rooms_tasks_title()}</Card.Title>
      <Card.Action>
        <Button href={roomTasksHref(data.room.id)} size="sm" variant="outline">
          {m.rooms_tasks_all()}
        </Button>
      </Card.Action>
    </Card.Header>
    <Card.Content>
      {#if tasks.length === 0}
        <EmptyState
          icon={ListChecksIcon}
          title={m.rooms_tasks_empty_title()}
          description={m.rooms_tasks_empty_body()}
          class="py-8"
        />
      {:else}
        <TaskRows {tasks} showAsset />
      {/if}
    </Card.Content>
  </Card.Root>

  <LinkedDocsCard
    title={m.room_docs_title()}
    pages={data.pages}
    createHref={newDocHref({ roomId: data.room.id, section: "room" })}
    moreHref={docsFilterHref({ roomId: data.room.id })}
    emptyTitle={m.room_docs_empty_title()}
    emptyBody={m.room_docs_empty_body()}
    createLabel={m.docs_create_page()}
    moreLabel={m.docs_show_all({ count: data.pages.length })}
    canWrite={data.scopes.includes("docs:write")}
  />

  <LinkedDocuments ownerType="room" ownerId={data.room.id} />
</div>

<RoomFormDialog bind:open={editOpen} room={data.room} onsaved={invalidateAll} />

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.rooms_delete_title()}
  description={m.rooms_delete_description({ name: data.room.name })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
