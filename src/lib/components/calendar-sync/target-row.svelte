<script lang="ts">
  import { resolve } from "$app/paths";
  import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { z } from "zod";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type {
    CalendarTarget,
    calendarSyncResponseSchema,
  } from "$lib/api/schemas/calendar-sync";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { targetState } from "$lib/calendar-sync/health";
  import {
    calendarKindLabels,
    capabilityLevel,
    capabilityNotes,
  } from "$lib/calendar-sync/labels";
  import { providerName } from "$lib/calendar-sync/providers";
  import {
    statLines,
    statsNeedAttention,
    statsSummary,
  } from "$lib/calendar-sync/stats";
  import { integrationErrorMessage } from "$lib/connections/errors";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import TargetStatusBadge from "./target-status-badge.svelte";

  type SyncResult = z.infer<typeof calendarSyncResponseSchema>;

  let {
    target,
    timeZone,
    connectionUsable,
    onedit,
    ondelete,
    onchanged,
  }: {
    target: CalendarTarget;
    timeZone: string | undefined;
    /** The connection the target writes through is saved and switched on. */
    connectionUsable: boolean;
    onedit: () => void;
    ondelete: () => void;
    /** Called after the target changed on the server; reloads the list. */
    onchanged: () => Promise<void>;
  } = $props();

  let syncing = $state(false);
  let result = $state<SyncResult | undefined>();
  let syncError = $state<string | undefined>();
  let enabledOverride = $state<boolean | undefined>();
  let toggleError = $state<string | undefined>();

  const health = $derived(targetState(target, connectionUsable));
  const enabled = $derived(enabledOverride ?? target.enabled);
  const level = $derived(capabilityLevel(target.capabilities));
  const limitNote = $derived(capabilityNotes[level]);
  const name = $derived(providerName(target.provider));
  /**
   * What the last run did. A run that failed before it counted anything leaves the counts of the
   * run before it, which would read as news next to the error, so after a failure only counts that
   * name a problem are shown.
   */
  /**
   * The answer of the run the person started, for as long as it is the latest one: a run of the
   * scheduler after it replaces what the row says, so the answer would only contradict it.
   */
  const shownResult = $derived(
    result &&
      result.target.lastCheckedAt === target.lastCheckedAt &&
      result.target.lastOkAt === target.lastOkAt
      ? result
      : undefined,
  );
  const lastRun = $derived(
    target.lastStats !== null &&
      (target.status !== "error" || statsNeedAttention(target.lastStats))
      ? target.lastStats
      : null,
  );

  function when(iso: string): { relative: string; absolute: string } {
    return {
      relative: formatRelativeInstant(iso),
      absolute: formatDateTime(iso, { timeZone }),
    };
  }

  async function syncNow() {
    if (syncing) return;
    syncing = true;
    syncError = undefined;
    result = undefined;
    try {
      result = await api.call(endpoints.calendarTargetsSync, {
        params: { id: target.id },
      });
    } catch (err) {
      syncError = apiErrorMessage(err);
      syncing = false;
      return;
    }
    // A run records the target's health, so the row shows the new state (and with it the answer).
    await onchanged();
    syncing = false;
  }

  async function setEnabled(next: boolean) {
    enabledOverride = next;
    toggleError = undefined;
    try {
      await api.call(endpoints.calendarTargetsUpdate, {
        params: { id: target.id },
        body: { enabled: next },
      });
      await onchanged();
    } catch (err) {
      toggleError = apiErrorMessage(err);
    } finally {
      enabledOverride = undefined;
    }
  }
</script>

<li class="flex flex-col gap-4 p-4">
  <div class="flex items-start justify-between gap-2">
    <div class="flex min-w-0 flex-col gap-2">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 class="min-w-0 font-medium wrap-anywhere">{target.name}</h3>
        <TargetStatusBadge state={health} />
        <Badge variant="secondary">
          {target.level === "household"
            ? m.caltargets_level_household()
            : m.caltargets_level_user()}
        </Badge>
        {#if target.level === "user"}
          <Badge variant="outline">
            {target.config.scope === "mine"
              ? m.caltargets_scope_mine()
              : m.caltargets_scope_all()}
          </Badge>
        {/if}
      </div>
      <p class="text-muted-foreground flex min-w-0 items-start gap-1.5 text-xs">
        <CalendarDaysIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0">
          {name}
          <span aria-hidden="true">·</span>
          <span class="font-mono break-all">{target.remoteCalendarId}</span>
        </span>
      </p>
    </div>
    {#if target.canManage}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              class="-me-2 -mt-1 shrink-0"
              aria-label={m.caltargets_actions_aria({ name: target.name })}
            >
              <EllipsisVerticalIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-52">
          <DropdownMenu.Item class="min-h-10" onSelect={onedit}>
            <PencilIcon />{m.common_edit()}
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
    {/if}
  </div>

  <ul class="flex flex-wrap gap-1" aria-label={m.caltargets_kinds_aria()}>
    {#each target.config.kinds as kind (kind)}
      <li class="max-w-full">
        <Badge variant="outline" class="max-w-full">
          <CheckIcon aria-hidden="true" />
          <span class="truncate">{calendarKindLabels[kind]()}</span>
        </Badge>
      </li>
    {/each}
  </ul>

  {#if health === "error"}
    <Alert.Root variant="destructive" class="border-destructive/40">
      <TriangleAlertIcon />
      <Alert.Title>{m.caltargets_error_title()}</Alert.Title>
      <Alert.Description class="text-pretty">
        {integrationErrorMessage(target.lastError, target.provider)}
        {#if target.consecutiveFailures > 0}
          <span class="mt-1 block text-xs opacity-90">
            {m.integration_failures({ count: target.consecutiveFailures })}
          </span>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {:else if health === "offline"}
    <Alert.Root class="border-warning/50">
      <TriangleAlertIcon class="text-warning" />
      <Alert.Description class="text-pretty">
        {m.caltargets_offline_note({ provider: name })}
        {#if target.canManage}
          <a
            href={resolve("/settings/integrations")}
            class="text-foreground mt-1 block font-medium underline underline-offset-4 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center"
          >
            {m.caltargets_noconn_action_member()}
          </a>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {/if}

  <dl
    class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 text-sm"
  >
    <dt class="text-muted-foreground">{m.caltargets_last_ok()}</dt>
    <dd class="min-w-0 font-medium">
      {#if target.lastOkAt}
        {@const t = when(target.lastOkAt)}
        <time datetime={target.lastOkAt} title={t.absolute}>{t.relative}</time>
        <span
          class="text-muted-foreground block text-xs font-normal pointer-fine:hidden"
          >{t.absolute}</span
        >
      {:else}
        <span class="text-muted-foreground font-normal"
          >{m.caltargets_never()}</span
        >
      {/if}
    </dd>
    <dt class="text-muted-foreground">{m.caltargets_last_checked()}</dt>
    <dd class="min-w-0 font-medium">
      {#if target.lastCheckedAt}
        {@const t = when(target.lastCheckedAt)}
        <time datetime={target.lastCheckedAt} title={t.absolute}
          >{t.relative}</time
        >
      {:else}
        <span class="text-muted-foreground font-normal"
          >{m.caltargets_never()}</span
        >
      {/if}
    </dd>
    <dt class="text-muted-foreground">{m.caltargets_event_count()}</dt>
    <dd class="font-medium tabular-nums">
      {m.caltargets_event_count_value({ count: target.eventCount })}
    </dd>
    {#if lastRun}
      <dt class="text-muted-foreground">{m.caltargets_last_run()}</dt>
      <dd class="min-w-0 font-medium text-pretty">
        {statsSummary(lastRun)}
      </dd>
    {/if}
  </dl>

  {#if limitNote}
    <p
      class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-pretty"
    >
      <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{limitNote()}</span>
    </p>
  {/if}

  {#if target.canManage}
    <div class="flex flex-col gap-3 border-t pt-4">
      <SwitchField
        id={`caltarget-enabled-${target.id}`}
        bind:checked={() => enabled, (next) => void setEnabled(next)}
        disabled={enabledOverride !== undefined}
        label={m.caltargets_enabled()}
        hint={m.caltargets_enabled_hint()}
      />
      <FormAlert message={toggleError} />

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          variant="outline"
          class="max-sm:w-full"
          disabled={syncing || !target.enabled}
          onclick={syncNow}
        >
          {#if syncing}
            <LoaderCircleIcon class="animate-spin" />{m.caltargets_syncing()}
          {:else}
            <RefreshCwIcon />{m.caltargets_sync_now()}
          {/if}
        </Button>
        {#if !target.enabled}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.caltargets_sync_paused()}
          </p>
        {/if}
      </div>

      <FormAlert message={syncError} />

      {#if shownResult}
        {@const failed = !shownResult.ok}
        {@const resultLines = statLines(shownResult.counts)}
        <div
          role="status"
          class={failed
            ? "bg-destructive/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"
            : "bg-success/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"}
        >
          {#if failed}
            <CircleXIcon
              class="text-destructive mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
          {:else}
            <CircleCheckIcon
              class="text-success mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
          {/if}
          <div class="flex min-w-0 flex-col gap-1">
            <p class="font-medium">
              {failed ? m.caltargets_sync_failed() : m.caltargets_sync_ok()}
            </p>
            {#if failed}
              <p class="text-muted-foreground text-xs text-pretty">
                {integrationErrorMessage(
                  shownResult.error?.code ?? null,
                  target.provider,
                )}
              </p>
            {/if}
            {#if resultLines.length > 0 || !failed}
              <p class="text-muted-foreground text-xs text-pretty">
                {statsSummary(shownResult.counts)}
              </p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</li>
