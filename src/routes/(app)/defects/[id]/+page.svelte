<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BanIcon from "@lucide/svelte/icons/ban";
  import CameraIcon from "@lucide/svelte/icons/camera";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import FlagIcon from "@lucide/svelte/icons/flag";
  import HammerIcon from "@lucide/svelte/icons/hammer";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import UndoIcon from "@lucide/svelte/icons/undo-2";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { DefectStatus } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { DEFECT_TRANSITIONS } from "$lib/api/schemas/defects";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import CommentBody from "$lib/components/comments/comment-body.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import DefectDeadline from "$lib/components/defects/defect-deadline.svelte";
  import DefectSeverityBadge from "$lib/components/defects/defect-severity-badge.svelte";
  import DefectStatusBadge from "$lib/components/defects/defect-status-badge.svelte";
  import DefectStatusDialog from "$lib/components/defects/defect-status-dialog.svelte";
  import DefectStepper from "$lib/components/defects/defect-stepper.svelte";
  import DefectTimeline from "$lib/components/defects/defect-timeline.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { formatDateTime, formatDay } from "$lib/format";
  import { assetHref, roomHref, taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const defect = $derived(data.defect);
  const today = $derived(data.today);
  const comments = $derived(new Map(data.comments.map((c) => [c.id, c])));

  let target = $state<DefectStatus>("reported");
  let dialogOpen = $state(false);
  let dialogMounted = $state(false);
  let deleteOpen = $state(false);

  function change(next: DefectStatus) {
    target = next;
    dialogMounted = true;
    dialogOpen = true;
  }

  const closed = $derived(
    defect.status === "fixed" || defect.status === "rejected",
  );
  /** The next logical step and the shortcut to "fixed" stay in reach; the rest is in the menu. */
  const primary = $derived<DefectStatus[]>(
    closed
      ? ["open"]
      : defect.status === "open"
        ? ["reported", "fixed"]
        : defect.status === "reported"
          ? ["in_progress", "fixed"]
          : ["fixed"],
  );
  const more = $derived(
    DEFECT_TRANSITIONS[defect.status].filter((s) => !primary.includes(s)),
  );

  const actionLabels = $derived<Record<DefectStatus, string>>({
    open: closed ? m.defect_action_reopen() : m.defect_action_back_to_open(),
    reported: m.defect_action_reported(),
    in_progress: m.defect_action_in_progress(),
    fixed: m.defect_action_fixed(),
    rejected: m.defect_action_rejected(),
  });
  const actionIcons = {
    open: RotateCcwIcon,
    reported: FlagIcon,
    in_progress: HammerIcon,
    fixed: CircleCheckIcon,
    rejected: BanIcon,
  };

  async function remove() {
    await api.call(endpoints.defectsDelete, { params: { id: defect.id } });
    toast.success(m.defect_deleted_toast({ number: defect.number }));
    await goto(resolve("/defects"), { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>#{defect.number} {defect.title} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div>
    <a
      href={resolve("/defects")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.defect_back()}
    </a>
  </div>

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <p class="text-muted-foreground text-sm font-medium tabular-nums">
        {m.defect_number_label({ number: defect.number })}
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance break-words md:text-3xl"
      >
        {defect.title}
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DefectStatusBadge status={defect.status} class="text-sm" />
        <DefectSeverityBadge severity={defect.severity} />
        <DefectDeadline
          date={defect.deadlineDate}
          status={defect.status}
          {today}
          labelled
          class="text-sm"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      {#each primary as status, index (status)}
        {@const Icon = actionIcons[status]}
        <Button
          size="lg"
          variant={index === 0 && !closed ? "default" : "outline"}
          onclick={() => change(status)}
        >
          <Icon />
          {actionLabels[status]}
        </Button>
      {/each}
      <Button
        size="lg"
        variant="outline"
        href={resolve(`/defects/${defect.id}/edit` as "/")}
      >
        <PencilIcon />
        {m.common_edit()}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              aria-label={m.defect_more_actions()}
            >
              <EllipsisIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-52">
          {#each more as status (status)}
            {@const Icon = status === "open" ? UndoIcon : actionIcons[status]}
            <DropdownMenu.Item class="min-h-10" onSelect={() => change(status)}>
              <Icon />
              {actionLabels[status]}
            </DropdownMenu.Item>
          {/each}
          {#if more.length > 0}
            <DropdownMenu.Separator />
          {/if}
          <DropdownMenu.Item
            class="text-destructive focus:text-destructive min-h-10"
            onSelect={() => (deleteOpen = true)}
          >
            <Trash2Icon />
            {m.common_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </header>

  <div
    class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="lg:col-start-1">
      <Card.Content>
        <DefectStepper
          status={defect.status}
          discoveredOn={defect.discoveredOn}
          reportedOn={defect.reportedOn}
          fixedOn={defect.fixedOn}
          {today}
        />
      </Card.Content>
    </Card.Root>

    <aside
      class="flex flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1"
    >
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.defect_facts()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-3 text-sm">
            {#if defect.roomName || defect.assetName}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.defect_place()}
                </dt>
                <dd class="mt-0.5 break-words">
                  {#if defect.roomName && defect.roomId}
                    <a
                      href={roomHref(defect.roomId)}
                      class="focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                      >{defect.roomName}</a
                    >
                  {/if}
                  {#if defect.roomName && defect.assetName}
                    <span class="mx-1" aria-hidden="true">·</span>
                  {/if}
                  {#if defect.assetName && defect.assetId}
                    <a
                      href={assetHref(defect.assetId)}
                      class="focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                      >{defect.assetName}</a
                    >
                  {/if}
                </dd>
              </div>
            {/if}
            {#if defect.locationDetail}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.defect_location_detail()}
                </dt>
                <dd class="mt-0.5 break-words">{defect.locationDetail}</dd>
              </div>
            {/if}
            <div>
              <dt class="text-muted-foreground text-xs">
                {m.defect_discovered_on()}
              </dt>
              <dd class="mt-0.5 tabular-nums">
                {formatDay(defect.discoveredOn)}
              </dd>
            </div>
            {#if defect.reportedOn}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.defect_reported_on()}
                </dt>
                <dd class="mt-0.5 tabular-nums">
                  {formatDay(defect.reportedOn)}
                </dd>
              </div>
            {/if}
            <div>
              <dt class="text-muted-foreground text-xs">
                {m.defect_responsible()}
              </dt>
              <dd class="mt-0.5 break-words">
                {defect.responsibleContactName ?? m.defect_responsible_none()}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs">
                {m.defect_deadline()}
              </dt>
              <dd class="mt-0.5">
                {#if defect.deadlineDate}
                  <span class="tabular-nums"
                    >{formatDay(defect.deadlineDate)}</span
                  >
                  {#if defect.deadlineSource === "handover"}
                    <span class="text-muted-foreground block text-xs"
                      >{m.defect_deadline_from_handover()}</span
                    >
                  {/if}
                {:else}
                  {m.defect_deadline_none()}
                {/if}
              </dd>
            </div>
            {#if defect.fixedOn}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.defect_fixed_on()}
                </dt>
                <dd class="mt-0.5 tabular-nums">
                  {formatDay(defect.fixedOn)}
                </dd>
              </div>
            {/if}
            <div>
              <dt class="text-muted-foreground text-xs">
                {m.defect_created()}
              </dt>
              <dd class="mt-0.5 tabular-nums">
                {formatDateTime(defect.createdAt, {
                  timeZone: data.timeZone,
                })}
              </dd>
            </div>
          </dl>
        </Card.Content>
      </Card.Root>

      {#if defect.reminderTaskId}
        <Card.Root>
          <Card.Header>
            <Card.Title class="text-base">{m.defect_reminder()}</Card.Title>
            <Card.Description
              >{m.defect_reminder_description()}</Card.Description
            >
          </Card.Header>
          <Card.Content>
            <Button
              variant="outline"
              size="lg"
              href={taskHref(defect.reminderTaskId)}
            >
              {m.defect_reminder_open()}
            </Button>
          </Card.Content>
        </Card.Root>
      {/if}
    </aside>

    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.defect_description()}</Card.Title>
      </Card.Header>
      <Card.Content>
        {#if defect.descriptionMd.trim()}
          <CommentBody text={defect.descriptionMd} />
        {:else}
          <p class="text-muted-foreground text-sm">
            {m.defect_description_empty()}
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if defect.resolutionMd.trim()}
      <Card.Root class="lg:col-start-1">
        <Card.Header>
          <Card.Title class="text-base">{m.defect_resolution()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <CommentBody text={defect.resolutionMd} />
        </Card.Content>
      </Card.Root>
    {/if}

    <div class="lg:col-start-1">
      <DefectTimeline
        defectId={defect.id}
        items={data.timeline}
        {comments}
        timeZone={data.timeZone}
      />
    </div>

    <Card.Root class="lg:col-start-1" data-slot="defect-photos">
      <Card.Header>
        <Card.Title class="text-base">{m.defect_photos()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <!-- Photos: attach images here once the attachments API (entityType "defect") is on main. -->
        <EmptyState
          icon={CameraIcon}
          title={m.coming_soon_badge()}
          description={m.defect_photos_soon()}
          class="py-8"
        />
      </Card.Content>
    </Card.Root>
  </div>
</div>

{#if dialogMounted}
  <DefectStatusDialog bind:open={dialogOpen} {defect} {target} {today} />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.defect_delete_title()}
  description={m.defect_delete_description({
    number: defect.number,
    title: defect.title,
  })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
