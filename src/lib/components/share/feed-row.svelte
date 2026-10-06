<script lang="ts">
  import BellIcon from "@lucide/svelte/icons/bell";
  import BellOffIcon from "@lucide/svelte/icons/bell-off";
  import CalendarPlusIcon from "@lucide/svelte/icons/calendar-plus";
  import CheckIcon from "@lucide/svelte/icons/check";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import QrCodeIcon from "@lucide/svelte/icons/qr-code";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { page } from "$app/state";
  import type { CalendarFeed } from "$lib/api/schemas/share";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { absoluteUrl, webcalUrl } from "$lib/share/urls";

  let {
    feed,
    timeZone,
    onedit,
    onqr,
    onrotate,
    ondelete,
  }: {
    feed: CalendarFeed;
    timeZone: string | undefined;
    onedit: () => void;
    onqr: () => void;
    onrotate: () => void;
    ondelete: () => void;
  } = $props();

  const https = $derived(
    feed.url ? absoluteUrl(feed.url, page.url.origin) : null,
  );
  const included = $derived(
    [
      [feed.includePreparations, m.feeds_chip_preparations()],
      [feed.includeDefects, m.feeds_chip_defects()],
      [feed.includeWarranties, m.feeds_chip_warranties()],
      [feed.includeEstimated, m.feeds_chip_estimated()],
    ].flatMap(([on, label]) => (on ? [String(label)] : [])),
  );
  const alarm = $derived(
    feed.alarmTime === null
      ? m.feeds_alarm_none()
      : feed.alarmDaysBefore === 0
        ? m.feeds_alarm_same_day({ time: feed.alarmTime })
        : feed.alarmDaysBefore === 1
          ? m.feeds_alarm_day_before({ time: feed.alarmTime })
          : m.feeds_alarm_days_before({
              time: feed.alarmTime,
              days: feed.alarmDaysBefore,
            }),
  );
</script>

<li class="flex flex-col gap-3 p-4">
  <div class="flex items-start justify-between gap-2">
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 class="min-w-0 font-medium break-words">{feed.name}</h3>
        <Badge variant="secondary">
          {feed.scope === "mine" ? m.feeds_scope_mine() : m.feeds_scope_all()}
        </Badge>
        <Badge variant="outline" class="uppercase">{feed.locale}</Badge>
      </div>
      <ul class="flex flex-wrap gap-1" aria-label={m.feeds_content()}>
        <li>
          <Badge variant="outline">
            <CheckIcon aria-hidden="true" />{m.feeds_chip_tasks()}
          </Badge>
        </li>
        {#each included as label (label)}
          <li>
            <Badge variant="outline">
              <CheckIcon aria-hidden="true" />{label}
            </Badge>
          </li>
        {/each}
      </ul>
    </div>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon-lg"
            class="-me-2 -mt-1 shrink-0"
            aria-label={m.feeds_actions_aria({ name: feed.name })}
          >
            <EllipsisVerticalIcon />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-52">
        <DropdownMenu.Item class="min-h-10" onSelect={onedit}>
          <PencilIcon />{m.common_edit()}
        </DropdownMenu.Item>
        <DropdownMenu.Item class="min-h-10" onSelect={onrotate}>
          <RefreshCwIcon />{m.feeds_rotate()}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="destructive"
          class="min-h-10"
          onSelect={ondelete}
        >
          <Trash2Icon />{m.common_delete()}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  <div class="text-muted-foreground flex flex-col gap-1 text-xs">
    <p class="flex items-center gap-1.5">
      {#if feed.alarmTime === null}
        <BellOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
      {:else}
        <BellIcon class="size-3.5 shrink-0" aria-hidden="true" />
      {/if}
      {alarm}
    </p>
    <p
      class="flex items-center gap-1.5"
      title={feed.lastFetchedAt
        ? formatDateTime(feed.lastFetchedAt, { timeZone })
        : undefined}
    >
      <RefreshCwIcon class="size-3.5 shrink-0" aria-hidden="true" />
      {feed.lastFetchedAt
        ? m.feeds_last_fetched({
            when: formatRelativeInstant(feed.lastFetchedAt),
          })
        : m.feeds_never_fetched()}
    </p>
  </div>

  {#if https}
    <div
      class="grid grid-cols-2 gap-2 *:w-full sm:flex sm:flex-wrap sm:items-center sm:*:w-auto"
    >
      <CopyButton
        value={https}
        label={m.common_copy()}
        copiedMessage={m.feeds_url_copied()}
      />
      <Button type="button" variant="outline" size="sm" onclick={onqr}>
        <QrCodeIcon />{m.feeds_show_qr()}
      </Button>
      <Button
        href={webcalUrl(https)}
        variant="outline"
        size="sm"
        class="col-span-2 sm:col-auto"
      >
        <CalendarPlusIcon />{m.feeds_open_in_calendar()}
      </Button>
    </div>
  {:else}
    <div
      class="border-warning/50 bg-warning/5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm"
    >
      <TriangleAlertIcon
        class="text-warning size-4 shrink-0"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 text-pretty">{m.feeds_url_missing()}</span>
      <Button type="button" variant="outline" size="sm" onclick={onrotate}>
        <RefreshCwIcon />{m.feeds_rotate()}
      </Button>
    </div>
  {/if}
</li>
