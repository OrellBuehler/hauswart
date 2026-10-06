<script lang="ts">
  import BellIcon from "@lucide/svelte/icons/bell";
  import CheckCheckIcon from "@lucide/svelte/icons/check-check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Notification } from "$lib/api/schemas/notifications";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { refreshUnread, unread } from "$lib/notifications/unread.svelte";
  import { m } from "$lib/paraglide/messages";
  import NotificationItem from "./notification-item.svelte";

  const POLL_MS = 60_000;
  const LATEST = 8;

  let open = $state(false);
  let items = $state<Notification[]>([]);
  let loading = $state(false);
  let loadFailed = $state(false);
  let markingAll = $state(false);

  $effect(() => {
    void refreshUnread();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshUnread();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  async function load() {
    loading = true;
    loadFailed = false;
    try {
      const page = await api.call(endpoints.notificationsList, {
        query: { limit: LATEST },
      });
      items = page.items;
    } catch (err) {
      loadFailed = true;
      toast.error(apiErrorMessage(err));
    } finally {
      loading = false;
    }
    void refreshUnread();
  }

  $effect(() => {
    if (open) void load();
  });

  async function markRead(notification: Notification) {
    open = false;
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
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      markingAll = false;
    }
  }

  const label = $derived(
    unread.count > 0
      ? m.notifications_bell_unread({ count: unread.count })
      : m.notifications_bell(),
  );
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon-lg"
        class="relative size-10"
        aria-label={label}
      >
        <BellIcon />
        {#if unread.count > 0}
          <span
            class="bg-destructive absolute end-1 top-1 flex min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] leading-4.5 font-semibold text-white tabular-nums"
            aria-hidden="true">{unread.count > 99 ? "99+" : unread.count}</span
          >
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    collisionPadding={8}
    class="w-[min(26rem,calc(100vw-1rem))] p-0"
    aria-label={m.notifications_title()}
  >
    <div class="flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <h2 class="text-sm font-semibold">{m.notifications_title()}</h2>
      <Button
        variant="ghost"
        size="sm"
        class="h-9"
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
    </div>
    <div class="max-h-[min(28rem,70svh)] overflow-y-auto p-1.5">
      {#if loading && items.length === 0}
        <p
          class="text-muted-foreground flex items-center justify-center gap-2 px-4 py-8 text-sm"
        >
          <LoaderCircleIcon class="size-4 animate-spin" />
          {m.common_loading()}
        </p>
      {:else if loadFailed && items.length === 0}
        <p class="text-muted-foreground px-4 py-8 text-center text-sm">
          {m.error_generic()}
        </p>
      {:else if items.length === 0}
        <p class="text-muted-foreground px-4 py-8 text-center text-sm">
          {m.notifications_empty()}
        </p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each items as notification (notification.id)}
            <li>
              <NotificationItem {notification} onopen={markRead} />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="border-t p-1.5">
      <Button
        variant="ghost"
        class="h-10 w-full"
        href={resolve("/notifications")}
        onclick={() => (open = false)}
      >
        {m.notifications_view_all()}
      </Button>
    </div>
  </Popover.Content>
</Popover.Root>
