<script lang="ts">
  import AlarmClockIcon from "@lucide/svelte/icons/alarm-clock";
  import BellRingIcon from "@lucide/svelte/icons/bell-ring";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import PackageIcon from "@lucide/svelte/icons/package";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { Component } from "svelte";
  import { resolve } from "$app/paths";
  import type { NotificationKind } from "$lib/api/enums";
  import type { Notification } from "$lib/api/schemas/notifications";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import {
    notificationPath,
    notificationText,
  } from "$lib/notifications/render";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    notification,
    onopen,
    now = Date.now(),
  }: {
    notification: Notification;
    /** Called when the item is opened (to mark it read); the link then navigates. */
    onopen: (notification: Notification) => void;
    now?: number;
  } = $props();

  const icons: Record<NotificationKind, Component> = {
    prep: PackageIcon,
    due_soon: AlarmClockIcon,
    due: BellRingIcon,
    overdue: TriangleAlertIcon,
    digest: ListChecksIcon,
    info: InfoIcon,
    comment: MessageSquareIcon,
    hint: LightbulbIcon,
  };
  const tones: Record<NotificationKind, string> = {
    prep: "text-chart-2",
    due_soon: "text-warning",
    due: "text-warning",
    overdue: "text-destructive",
    digest: "text-muted-foreground",
    info: "text-muted-foreground",
    comment: "text-chart-2",
    hint: "text-warning",
  };

  const Icon = $derived(icons[notification.kind]);
  const path = $derived(notificationPath(notification));
  const unread = $derived(notification.readAt === null);
  const text = $derived(notificationText(notification));
</script>

{#snippet body()}
  <span
    class={cn(
      "bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
      tones[notification.kind],
    )}
  >
    <Icon class="size-4" aria-hidden="true" />
  </span>
  <span class="min-w-0 flex-1">
    <span
      class={cn(
        "block text-sm text-pretty break-words",
        unread ? "font-medium" : "text-muted-foreground",
      )}
    >
      {text}
    </span>
    <time
      class="text-muted-foreground mt-0.5 block text-xs"
      datetime={notification.createdAt}
      title={formatDateTime(notification.createdAt)}
      >{formatRelativeInstant(notification.createdAt, now)}</time
    >
  </span>
  {#if unread}
    <span class="bg-brand mt-2 size-2 shrink-0 rounded-full" aria-hidden="true"
    ></span>
    <span class="sr-only">{m.notifications_unread()}</span>
  {/if}
{/snippet}

{#if path}
  <a
    href={resolve(path as "/")}
    class="hover:bg-accent focus-visible:ring-ring/50 flex min-h-12 items-start gap-3 rounded-lg px-3 py-2.5 text-start outline-none focus-visible:ring-[3px]"
    onclick={() => onopen(notification)}
  >
    {@render body()}
  </a>
{:else}
  <button
    type="button"
    class="hover:bg-accent focus-visible:ring-ring/50 flex min-h-12 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start outline-none focus-visible:ring-[3px]"
    onclick={() => onopen(notification)}
  >
    {@render body()}
  </button>
{/if}
