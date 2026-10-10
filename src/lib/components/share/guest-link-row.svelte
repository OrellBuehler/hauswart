<script lang="ts">
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import LockOpenIcon from "@lucide/svelte/icons/lock-open";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import UserXIcon from "@lucide/svelte/icons/user-x";
  import type { GuestLink } from "$lib/api/schemas/share";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { localDateOf } from "$lib/dates";
  import {
    formatDate,
    formatDateTime,
    formatRelativeInstant,
  } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import {
    guestSectionLabels,
    guestStatusLabels,
    guestStatusTones,
  } from "$lib/share/labels";
  import { cn } from "$lib/utils";

  let {
    link,
    timeZone,
    onedit,
    onrotate,
    onrevoke,
  }: {
    link: GuestLink;
    timeZone: string;
    onedit: () => void;
    onrotate: () => void;
    onrevoke: () => void;
  } = $props();

  const day = (iso: string) =>
    formatDate(localDateOf(timeZone, Date.parse(iso)));
  const validity = $derived(
    link.startsAt
      ? m.glinks_window_range({
          from: day(link.startsAt),
          until: day(link.expiresAt),
        })
      : m.glinks_window_until({ until: day(link.expiresAt) }),
  );
  const dead = $derived(link.status === "revoked" || link.status === "expired");
</script>

<li class={cn("flex flex-col gap-3 p-4", dead && "bg-muted/30")}>
  <div class="flex items-start justify-between gap-2">
    <div class="flex min-w-0 flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3
          class={cn(
            "min-w-0 font-medium break-words",
            dead && "text-muted-foreground",
          )}
        >
          {link.label}
        </h3>
        <Badge variant="outline" class={guestStatusTones[link.status]}>
          {guestStatusLabels[link.status]()}
        </Badge>
      </div>
      <p class="text-muted-foreground text-sm">{validity}</p>
    </div>
    {#if link.status !== "revoked"}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              class="-me-2 -mt-1 shrink-0"
              aria-label={m.glinks_actions_aria({ label: link.label })}
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
            <RefreshCwIcon />{m.glinks_rotate()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            class="min-h-10"
            onSelect={onrevoke}
          >
            <UserXIcon />{m.glinks_revoke()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <ul class="flex flex-wrap gap-1.5" aria-label={m.glinks_properties()}>
    <li>
      <Badge variant="outline">
        {#if link.hasPin}
          <LockKeyholeIcon aria-hidden="true" />{m.glinks_badge_pin()}
        {:else}
          <LockOpenIcon aria-hidden="true" />{m.glinks_badge_no_pin()}
        {/if}
      </Badge>
    </li>
    <li>
      {#if link.includeSecrets}
        <Badge
          variant="outline"
          class="border-destructive/30 bg-destructive/10 text-destructive"
        >
          <ShieldAlertIcon aria-hidden="true" />{m.glinks_badge_secrets()}
        </Badge>
      {:else}
        <Badge variant="outline">{m.glinks_badge_no_secrets()}</Badge>
      {/if}
    </li>
    <li><Badge variant="secondary" class="uppercase">{link.locale}</Badge></li>
  </ul>

  {#if link.sections.length > 0 || link.pageIds.length > 0}
    <ul
      class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs"
      aria-label={m.glinks_sections()}
    >
      {#each link.sections as section (section)}
        <li>{guestSectionLabels[section]()}</li>
      {/each}
      {#if link.pageIds.length > 0}
        <li>{m.glinks_extra_pages({ count: link.pageIds.length })}</li>
      {/if}
    </ul>
  {:else}
    <p class="text-muted-foreground text-xs">{m.glinks_no_sections()}</p>
  {/if}

  {#if link.pinLocked}
    <div
      class="border-warning/50 bg-warning/5 flex items-start gap-2 rounded-lg border p-3 text-sm"
    >
      <TriangleAlertIcon
        class="text-warning mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span class="text-pretty">{m.glinks_pin_locked()}</span>
    </div>
  {/if}

  <p
    class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
  >
    <EyeIcon class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="tabular-nums">{m.glinks_views({ count: link.viewCount })}</span
    >
    <span aria-hidden="true">·</span>
    <span
      title={link.lastViewedAt
        ? formatDateTime(link.lastViewedAt, { timeZone })
        : undefined}
    >
      {link.lastViewedAt
        ? m.glinks_last_viewed({
            when: formatRelativeInstant(link.lastViewedAt),
          })
        : m.glinks_never_viewed()}
      {#if link.lastViewedAt}
        <span class="pointer-fine:hidden">
          ({formatDateTime(link.lastViewedAt, { timeZone })})
        </span>
      {/if}
    </span>
    {#if link.createdByName}
      <span aria-hidden="true">·</span>
      <span>{m.glinks_created_by({ name: link.createdByName })}</span>
    {/if}
  </p>
</li>
