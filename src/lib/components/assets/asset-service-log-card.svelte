<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import ClipboardListIcon from "@lucide/svelte/icons/clipboard-list";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { ServiceLogEntry } from "$lib/api/schemas/service-log";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { serviceLogKindLabels } from "$lib/hints/labels";
  import { contactHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import ServiceLogFormDialog from "./service-log-form-dialog.svelte";

  let {
    assetId,
    entries,
    nextCursor,
    today,
    currency,
  }: {
    assetId: string;
    entries: ServiceLogEntry[];
    nextCursor: string | null;
    today: string;
    currency: string;
  } = $props();

  let formOpen = $state(false);
  let editing = $state<ServiceLogEntry | undefined>();
  let deleting = $state<ServiceLogEntry | undefined>();
  let deleteOpen = $state(false);

  let more = $state.raw<{
    base: ServiceLogEntry[];
    items: ServiceLogEntry[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  const loaded = $derived(more && more.base === entries ? more : null);
  const all = $derived([...entries, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : nextCursor);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.assetServiceLogList, {
        params: { id: assetId },
        query: { limit: 20, cursor },
      });
      more = {
        base: entries,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(entry: ServiceLogEntry) {
    editing = entry;
    formOpen = true;
  }

  function askDelete(entry: ServiceLogEntry) {
    deleting = entry;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    const { id, title } = deleting;
    await api.call(endpoints.assetServiceLogDelete, {
      params: { id: assetId, entryId: id },
    });
    toast.success(m.service_deleted_toast({ title }));
    await invalidateAll();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.asset_service_title()}</Card.Title>
    <Card.Action>
      <Button size="sm" variant="outline" onclick={openCreate}>
        <PlusIcon />{m.service_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if all.length === 0}
      <EmptyState
        icon={ClipboardListIcon}
        title={m.service_empty_title()}
        description={m.service_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          <Button onclick={openCreate}><PlusIcon />{m.service_add()}</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y">
        {#each all as entry (entry.id)}
          <li class="flex items-start gap-2 py-3.5 first:pt-0 last:pb-0">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="secondary">
                  {serviceLogKindLabels[entry.kind]()}
                </Badge>
                <span class="text-muted-foreground text-xs tabular-nums">
                  {formatDay(entry.date)}
                </span>
              </div>
              <h3 class="mt-1.5 text-sm font-medium break-words">
                {entry.title}
              </h3>
              {#if entry.descriptionMd.trim()}
                <p
                  class="text-muted-foreground mt-0.5 text-sm break-words whitespace-pre-line"
                >
                  {entry.descriptionMd}
                </p>
              {/if}
              {#if entry.contactName || entry.costMinor !== null}
                <p
                  class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
                >
                  {#if entry.contactName && entry.contactId}
                    <a
                      href={contactHref(entry.contactId)}
                      class="underline-offset-4 hover:underline"
                    >
                      {entry.contactName}
                    </a>
                  {:else if entry.contactName}
                    <span>{entry.contactName}</span>
                  {/if}
                  {#if entry.costMinor !== null}
                    <span class="text-foreground font-medium tabular-nums">
                      {formatMoney(entry.costMinor, entry.currency ?? currency)}
                    </span>
                  {/if}
                </p>
              {/if}
              <Attachments
                ownerType="service_log"
                ownerId={entry.id}
                variant="compact"
                title={m.service_files_title()}
                class="mt-2"
              />
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    class="-me-1.5"
                    aria-label={m.service_actions_aria({ title: entry.title })}
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  class="min-h-10"
                  onSelect={() => openEdit(entry)}
                >
                  <PencilIcon />{m.common_edit()}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  variant="destructive"
                  class="min-h-10"
                  onSelect={() => askDelete(entry)}
                >
                  <Trash2Icon />{m.common_delete()}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </li>
        {/each}
      </ul>
      {#if cursor}
        <div class="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="lg"
            disabled={loadingMore}
            onclick={loadMore}
          >
            {#if loadingMore}
              <LoaderCircleIcon class="animate-spin" />
            {/if}
            {m.common_load_more()}
          </Button>
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<ServiceLogFormDialog
  bind:open={formOpen}
  {assetId}
  entry={editing}
  {today}
  {currency}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.service_delete_title()}
  description={m.service_delete_description({ title: deleting?.title ?? "" })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
