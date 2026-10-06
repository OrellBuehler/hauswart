<script lang="ts">
  import BellIcon from "@lucide/svelte/icons/bell";
  import CheckCheckIcon from "@lucide/svelte/icons/check-check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Notification } from "$lib/api/schemas/notifications";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import NotificationItem from "$lib/components/notifications/notification-item.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { refreshUnread, unread } from "$lib/notifications/unread.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let more = $state.raw<{
    base: Notification[];
    items: Notification[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  let markingAll = $state(false);

  const loaded = $derived(more && more.base === data.items ? more : null);
  const items = $derived([...data.items, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : data.nextCursor);
  const now = Date.now();

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.notificationsList, {
        query: {
          limit: 30,
          cursor,
          ...(data.onlyUnread ? { unread: "true" as const } : {}),
        },
      });
      more = {
        base: data.items,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  async function markRead(notification: Notification) {
    if (notification.readAt !== null) return;
    try {
      await api.call(endpoints.notificationsRead, {
        params: { id: notification.id },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    void refreshUnread();
  }

  async function markAll() {
    if (markingAll) return;
    markingAll = true;
    try {
      await api.call(endpoints.notificationsReadAll);
      await invalidateAll();
      await refreshUnread();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      markingAll = false;
    }
  }

  function setFilter(value: "all" | "unread") {
    void goto(
      resolve(`/notifications${value === "unread" ? "?unread=1" : ""}` as "/"),
      { keepFocus: true, noScroll: true },
    );
  }
</script>

<svelte:head>
  <title>{m.notifications_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.notifications_title()}
    description={m.notifications_description()}
  >
    {#snippet actions()}
      <Button
        variant="outline"
        size="lg"
        disabled={markingAll || unread.count === 0}
        onclick={markAll}
      >
        {#if markingAll}
          <LoaderCircleIcon class="animate-spin" />
        {:else}
          <CheckCheckIcon />
        {/if}
        {m.notifications_mark_all()}
      </Button>
    {/snippet}
  </PageHeader>

  <Segmented
    label={m.notifications_filter()}
    options={[
      { value: "all", label: m.notifications_filter_all() },
      { value: "unread", label: m.notifications_filter_unread() },
    ]}
    value={data.onlyUnread ? "unread" : "all"}
    onchange={setFilter}
  />

  {#if items.length === 0}
    <EmptyState
      icon={BellIcon}
      title={data.onlyUnread
        ? m.notifications_empty_unread_title()
        : m.notifications_empty_title()}
      description={data.onlyUnread
        ? m.notifications_empty_unread_body()
        : m.notifications_empty_body()}
    />
  {:else}
    <Card.Root class="gap-0 p-1.5">
      <ul class="flex flex-col gap-0.5">
        {#each items as notification (notification.id)}
          <li>
            <NotificationItem {notification} onopen={markRead} {now} />
          </li>
        {/each}
      </ul>
    </Card.Root>
    {#if cursor}
      <div class="flex justify-center">
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
</div>
