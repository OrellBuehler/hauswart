<script lang="ts">
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BellRingIcon from "@lucide/svelte/icons/bell-ring";
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PhoneIcon from "@lucide/svelte/icons/phone";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import DeadlineHint from "$lib/components/insurance/deadline-hint.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { telHref } from "$lib/contacts/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay, formatRelativeDays } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { kindIcons } from "$lib/assets/kinds";
  import {
    deadlineInfo,
    deadlineTones,
    termEnded,
  } from "$lib/insurance/deadline";
  import {
    insuranceTypeIcons,
    insuranceTypeLabels,
    premiumPerLabels,
    renewalLabels,
  } from "$lib/insurance/labels";
  import { assetHref, contactHref, taskHref } from "$lib/links";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const policy = $derived(data.policy);
  const canWrite = $derived(data.scopes.includes("write"));
  const TypeIcon = $derived(insuranceTypeIcons[policy.type]);
  const archived = $derived(policy.archivedAt !== null);
  const deadline = $derived(
    deadlineInfo(policy.cancellationDeadline, data.today),
  );
  const ended = $derived(!archived && termEnded(policy.endDate, data.today));

  let deleteOpen = $state(false);
  let archiving = $state(false);

  async function toggleArchive() {
    if (archiving) return;
    archiving = true;
    try {
      await api.call(endpoints.insurancePoliciesUpdate, {
        params: { id: policy.id },
        body: { archived: !archived },
      });
      toast.success(
        archived
          ? m.insurance_restored_toast({ title: policy.title })
          : m.insurance_archived_toast({ title: policy.title }),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      archiving = false;
    }
  }

  async function remove() {
    const { id, title } = policy;
    await api.call(endpoints.insurancePoliciesDelete, { params: { id } });
    toast.success(m.insurance_deleted_toast({ title }));
    await gotoFromOverlay(resolve("/insurance"), { invalidateAll: true });
  }

  const linkClass =
    "focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]";
</script>

<svelte:head>
  <title>{policy.title} · {m.nav_insurance()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/insurance")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.nav_insurance()}
    </a>
  </div>

  <header class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 flex-col gap-2">
      <p
        class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm"
      >
        <TypeIcon class="size-4" aria-hidden="true" />
        <span>{insuranceTypeLabels[policy.type]()}</span>
        {#if archived}
          <Badge variant="secondary">{m.insurance_archived()}</Badge>
        {/if}
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
      >
        {policy.title}
      </h1>
      {#if !archived}
        <DeadlineHint
          deadline={policy.cancellationDeadline}
          today={data.today}
          class="text-sm"
        />
      {/if}
    </div>
    {#if canWrite}
      <div class="flex shrink-0 items-center gap-2">
        <Button
          href={resolve(`/insurance/${policy.id}/edit` as "/")}
          variant="outline"
          size="lg"
          class="max-sm:hidden"
        >
          <PencilIcon />{m.common_edit()}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon-lg"
                aria-label={m.insurance_actions()}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item class="min-h-10 sm:hidden">
              {#snippet child({ props })}
                <a
                  href={resolve(`/insurance/${policy.id}/edit` as "/")}
                  {...props}
                >
                  <PencilIcon />{m.common_edit()}
                </a>
              {/snippet}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="min-h-10"
              disabled={archiving}
              onSelect={toggleArchive}
            >
              {#if archived}
                <ArchiveRestoreIcon />{m.insurance_restore()}
              {:else}
                <ArchiveIcon />{m.insurance_archive()}
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              class="min-h-10"
              onSelect={() => (deleteOpen = true)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/if}
  </header>

  {#if ended}
    <Alert.Root>
      <TriangleAlertIcon />
      <Alert.Title>{m.insurance_term_ended_title()}</Alert.Title>
      <Alert.Description class="flex flex-col items-start gap-3">
        <p class="text-pretty">
          {m.insurance_term_ended_body({
            date: formatDay(policy.endDate ?? data.today),
          })}
        </p>
        {#if canWrite}
          <Button
            href={resolve(`/insurance/${policy.id}/edit` as "/")}
            variant="outline"
            size="lg"
          >
            <PencilIcon />{m.insurance_term_ended_action()}
          </Button>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {/if}

  <div
    class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <div class="flex min-w-0 flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.insurance_facts()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:gap-x-6">
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_insurer()}
              </dt>
              <dd class="mt-0.5 wrap-anywhere">
                {#if policy.insurerContactId && policy.insurerName}
                  <a
                    href={contactHref(policy.insurerContactId)}
                    class={linkClass}>{policy.insurerName}</a
                  >
                {:else}
                  –
                {/if}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_policy_number()}
              </dt>
              <dd class="mt-0.5 wrap-anywhere">{policy.policyNumber ?? "–"}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_premium()}
              </dt>
              <dd class="mt-0.5 tabular-nums">
                <span class="font-medium whitespace-nowrap"
                  >{formatMoney(policy.premiumMinor, policy.currency)}</span
                >
                <span class="text-muted-foreground text-xs">
                  {premiumPerLabels[policy.premiumPeriod]()}
                </span>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_premium_annual()}
              </dt>
              <dd class="mt-0.5 font-medium whitespace-nowrap tabular-nums">
                {formatMoney(policy.annualPremiumMinor, policy.currency)}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_deductible()}
              </dt>
              <dd class="mt-0.5 whitespace-nowrap tabular-nums">
                {policy.deductibleMinor === null
                  ? "–"
                  : formatMoney(policy.deductibleMinor, policy.currency)}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_start()}
              </dt>
              <dd class="mt-0.5 tabular-nums">{formatDay(policy.startDate)}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">{m.insurance_end()}</dt>
              <dd class="mt-0.5 tabular-nums">
                {#if policy.endDate}
                  {formatDay(policy.endDate)}
                  <span class="text-muted-foreground block text-xs"
                    >{m.insurance_end_hint()}</span
                  >
                {:else}
                  {m.insurance_end_open()}
                {/if}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_renewal()}
              </dt>
              <dd class="mt-0.5">{renewalLabels[policy.renewal]()}</dd>
            </div>
            {#if policy.renewal === "auto" && policy.cancellationNoticeMonths !== null}
              <div class="min-w-0">
                <dt class="text-muted-foreground text-xs">
                  {m.insurance_notice()}
                </dt>
                <dd class="mt-0.5">
                  {m.insurance_notice_value({
                    months: policy.cancellationNoticeMonths,
                  })}
                </dd>
              </div>
            {/if}
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.insurance_emergency()}
              </dt>
              <dd class="mt-0.5">
                {policy.showOnEmergency ? m.common_yes() : m.common_no()}
              </dd>
            </div>
          </dl>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.insurance_assets()}</Card.Title>
        </Card.Header>
        <Card.Content>
          {#if policy.assets.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.insurance_assets_none()}
            </p>
          {:else}
            <ul class="flex flex-col divide-y">
              {#each policy.assets as asset (asset.id)}
                {@const Icon = kindIcons[asset.kind]}
                <li>
                  <a
                    href={assetHref(asset.id)}
                    class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm outline-none focus-visible:ring-[3px]"
                  >
                    <Icon
                      class="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="min-w-0 font-medium wrap-anywhere"
                      >{asset.name}</span
                    >
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      {#if policy.notes}
        <Card.Root>
          <Card.Header>
            <Card.Title class="text-base">{m.insurance_notes()}</Card.Title>
          </Card.Header>
          <Card.Content>
            <p class="text-sm wrap-anywhere whitespace-pre-line">
              {policy.notes}
            </p>
          </Card.Content>
        </Card.Root>
      {/if}

      <Attachments
        ownerType="insurance_policy"
        ownerId={policy.id}
        editable={canWrite}
        title={m.insurance_files_title()}
        description={m.insurance_files_description()}
      />

      <LinkedDocuments
        ownerType="insurance_policy"
        ownerId={policy.id}
        editable={canWrite}
      />

      <Comments
        entityType="insurance_policy"
        entityId={policy.id}
        timeZone={data.timeZone}
      />
    </div>

    <aside class="flex min-w-0 flex-col gap-6 max-lg:order-first">
      {#if policy.assistancePhone}
        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2 text-base">
              <PhoneIcon class="size-4" aria-hidden="true" />
              {m.insurance_assistance()}
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <Button
              href={telHref(policy.assistancePhone)}
              size="lg"
              class="h-12 w-full gap-3 text-base font-semibold tabular-nums"
              aria-label={m.insurance_call_aria({ title: policy.title })}
            >
              <PhoneIcon class="shrink-0" aria-hidden="true" />
              <span class="min-w-0 truncate">{policy.assistancePhone}</span>
            </Button>
          </Card.Content>
        </Card.Root>
      {/if}

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <CalendarClockIcon class="size-4" aria-hidden="true" />
            {m.insurance_deadline_title()}
          </Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4 text-sm">
          {#if policy.cancellationDeadline}
            <div>
              <p class="text-muted-foreground text-xs">
                {m.insurance_cancel_by()}
              </p>
              <p class="mt-0.5 text-base font-semibold tabular-nums">
                {formatDay(policy.cancellationDeadline)}
              </p>
              {#if deadline && !archived}
                <p class={cn("mt-1 text-xs", deadlineTones[deadline.tone])}>
                  {#if deadline.tone === "overdue"}
                    {m.insurance_deadline_overdue()} ·
                  {/if}
                  {formatRelativeDays(deadline.days)}
                </p>
              {/if}
            </div>
          {:else}
            <p class="text-muted-foreground text-pretty">
              {m.insurance_deadline_none_detail()}
            </p>
          {/if}
          <div class="border-t pt-4">
            <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
              <BellRingIcon class="size-3.5" aria-hidden="true" />
              {m.insurance_reminder()}
            </p>
            {#if policy.reminderTaskId}
              <Button
                href={taskHref(policy.reminderTaskId)}
                variant="outline"
                size="lg"
                class="mt-2"
              >
                {m.insurance_reminder_open()}
              </Button>
            {:else}
              <p class="text-muted-foreground mt-1 text-pretty">
                {m.insurance_reminder_none()}
              </p>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
    </aside>
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.insurance_delete_title()}
  description={m.insurance_delete_description({ title: policy.title })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
