<script lang="ts">
  import AlarmClockIcon from "@lucide/svelte/icons/alarm-clock";
  import AlarmClockOffIcon from "@lucide/svelte/icons/alarm-clock-off";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CheckIcon from "@lucide/svelte/icons/check";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MessageSquarePlusIcon from "@lucide/svelte/icons/message-square-plus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import SkipForwardIcon from "@lucide/svelte/icons/skip-forward";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Completion } from "$lib/api/schemas/tasks";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import AssigneeAvatar from "$lib/components/tasks/assignee-avatar.svelte";
  import CompleteButton from "$lib/components/tasks/complete-button.svelte";
  import CompletionItem from "$lib/components/tasks/completion-item.svelte";
  import DueBadge from "$lib/components/tasks/due-badge.svelte";
  import ProgressBar from "$lib/components/tasks/progress-bar.svelte";
  import TaskPartsCard from "$lib/components/tasks/task-parts-card.svelte";
  import TaskActionDialog from "$lib/components/tasks/task-action-dialog.svelte";
  import TriggerSummary from "$lib/components/tasks/trigger-summary.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDate, formatDateShort, formatDateTime } from "$lib/format";
  import { assetHref, roomHref, taskEditHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { snoozeTask } from "$lib/tasks/actions";
  import {
    categoryLabels,
    notifyModeLabels,
    preparationKindLabels,
    preparationStateLabels,
    priorityLabels,
    reasonLabels,
    rotationLabels,
  } from "$lib/tasks/labels";
  import { rowFromTask } from "$lib/tasks/row";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const task = $derived(data.task);
  const taskState = $derived(task.state);
  const today = $derived(data.today);
  const people = $derived(
    new Map(data.people.map((p) => [p.id, p.displayName])),
  );
  const place = $derived({
    roomId: task.roomId ?? data.asset?.roomId ?? null,
    roomName: task.roomName ?? data.asset?.roomName ?? null,
  });
  const row = $derived(rowFromTask(task, people));
  const archived = $derived(task.archivedAt !== null);
  const now = Date.now();

  let dialog = $state<"complete" | "skip" | "snooze" | null>(null);
  let dialogOpen = $state(false);
  let deleteOpen = $state(false);
  let archiving = $state(false);
  let preparing = $state<string | null>(null);

  function openDialog(mode: "complete" | "skip" | "snooze") {
    dialog = mode;
    dialogOpen = true;
  }

  async function toggleArchive() {
    if (archiving) return;
    archiving = true;
    try {
      await api.call(endpoints.tasksUpdate, {
        params: { id: task.id },
        body: { archived: !archived },
      });
      toast.success(
        archived
          ? m.task_restored_toast({ title: task.title })
          : m.task_archived_toast({ title: task.title }),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      archiving = false;
    }
  }

  async function unsnooze() {
    try {
      await snoozeTask(task, null, task.snoozedUntil);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function remove() {
    await api.call(endpoints.tasksDelete, { params: { id: task.id } });
    toast.success(m.task_deleted_toast({ title: task.title }));
    await goto(resolve("/tasks"), { invalidateAll: true });
  }

  async function completePreparation(prepId: string, title: string) {
    if (preparing) return;
    preparing = prepId;
    try {
      await api.call(endpoints.preparationsComplete, {
        params: { id: task.id, prepId },
        body: {},
      });
      toast.success(m.toast_prep_done({ title }));
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      preparing = null;
    }
  }

  let more = $state.raw<{
    base: Completion[];
    items: Completion[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  const loaded = $derived(
    more && more.base === data.history.items ? more : null,
  );
  const history = $derived([...data.history.items, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : data.history.nextCursor);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.completionsList, {
        query: { taskId: task.id, limit: 20, cursor },
      });
      more = {
        base: data.history.items,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  const rotation = $derived(
    task.rotationOrder.map((id) => people.get(id) ?? "?"),
  );
  const currentAssignee = $derived(
    taskState?.currentAssigneeUserId
      ? (people.get(taskState.currentAssigneeUserId) ?? null)
      : null,
  );
  const reasons = $derived(
    (taskState?.reasons ?? []).filter(
      (r) => r !== "never_completed" || history.length === 0,
    ),
  );
</script>

<svelte:head>
  <title>{task.title} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div>
    <a
      href={resolve("/tasks")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.task_back()}
    </a>
  </div>

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <h1
        class="text-2xl font-semibold tracking-tight text-balance break-words md:text-3xl"
      >
        {task.title}
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DueBadge
          status={row.status}
          date={row.date}
          estimated={row.estimated}
          {today}
          class="text-sm"
        />
        <Badge variant="outline">{categoryLabels[task.category]()}</Badge>
        {#if task.priority !== "normal"}
          <Badge variant={task.priority === "high" ? "default" : "secondary"}>
            {priorityLabels[task.priority]()}
          </Badge>
        {/if}
        {#if archived}
          <Badge variant="secondary">{m.task_archived()}</Badge>
        {/if}
        {#if task.snoozedUntil && task.snoozedUntil > today}
          <Badge variant="secondary">
            {m.task_snoozed_until({ date: formatDate(task.snoozedUntil) })}
          </Badge>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      {#if !archived}
        <CompleteButton {task} variant="default" />
        <Button
          size="lg"
          variant="outline"
          onclick={() => openDialog("complete")}
        >
          <MessageSquarePlusIcon />
          {m.task_complete_with_note()}
        </Button>
      {/if}
      <Button size="lg" variant="outline" href={taskEditHref(task.id)}>
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
              aria-label={m.task_more_actions()}
            >
              <EllipsisIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-52">
          {#if !archived}
            <DropdownMenu.Item
              class="min-h-10"
              onSelect={() => openDialog("skip")}
            >
              <SkipForwardIcon />
              {m.task_skip()}
            </DropdownMenu.Item>
            {#if task.snoozedUntil && task.snoozedUntil > today}
              <DropdownMenu.Item class="min-h-10" onSelect={unsnooze}>
                <AlarmClockOffIcon />
                {m.task_unsnooze()}
              </DropdownMenu.Item>
            {:else}
              <DropdownMenu.Item
                class="min-h-10"
                onSelect={() => openDialog("snooze")}
              >
                <AlarmClockIcon />
                {m.task_snooze()}
              </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Separator />
          {/if}
          <DropdownMenu.Item
            class="min-h-10"
            disabled={archiving}
            onSelect={toggleArchive}
          >
            {#if archived}
              <ArchiveRestoreIcon />
              {m.task_restore()}
            {:else}
              <ArchiveIcon />
              {m.task_archive()}
            {/if}
          </DropdownMenu.Item>
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

  <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.task_description()}</Card.Title>
        </Card.Header>
        <Card.Content>
          {#if task.descriptionMd.trim()}
            <p class="text-sm leading-relaxed break-words whitespace-pre-wrap">
              {task.descriptionMd}
            </p>
          {:else}
            <p class="text-muted-foreground text-sm">
              {m.task_description_empty()}
            </p>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.task_preparations()}</Card.Title>
        </Card.Header>
        <Card.Content>
          {#if task.preparations.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.task_preparations_empty()}
            </p>
          {:else}
            <ul class="divide-y">
              {#each task.preparations as prep (prep.id)}
                {@const open = prep.state === "now" || prep.state === "not_yet"}
                <li class="flex items-center gap-3 py-3">
                  <div class="min-w-0 flex-1">
                    <p
                      class={cn(
                        "text-sm font-medium break-words",
                        !open && "text-muted-foreground line-through",
                      )}
                    >
                      {prep.title}
                    </p>
                    <p
                      class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs"
                    >
                      <span>{preparationKindLabels[prep.kind]()}</span>
                      {#if prep.leadDays !== null}
                        <span>{m.prep_lead_days({ days: prep.leadDays })}</span>
                      {/if}
                      <span
                        class={cn(
                          "rounded-full px-2 py-0.5 font-medium",
                          prep.state === "now"
                            ? "bg-warning/15 text-warning"
                            : "bg-muted",
                        )}>{preparationStateLabels[prep.state]()}</span
                      >
                    </p>
                  </div>
                  {#if open}
                    <Button
                      variant="outline"
                      size="lg"
                      disabled={preparing !== null}
                      aria-label={m.dashboard_prep_done_aria({
                        title: prep.title,
                      })}
                      onclick={() => completePreparation(prep.id, prep.title)}
                    >
                      {#if preparing === prep.id}
                        <LoaderCircleIcon class="animate-spin" />
                      {:else}
                        <CheckIcon />
                      {/if}
                      {m.task_complete()}
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <TaskPartsCard taskId={task.id} parts={data.parts} />

      <LinkedDocuments ownerType="task" ownerId={task.id} />

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <HistoryIcon
              class="text-muted-foreground size-4"
              aria-hidden="true"
            />
            {m.task_history()}
          </Card.Title>
          <Card.Description>{m.task_history_description()}</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if history.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.task_history_empty()}
            </p>
          {:else}
            <ul class="divide-y">
              {#each history as completion (completion.id)}
                <li>
                  <CompletionItem
                    {completion}
                    undoable
                    timeZone={data.timeZone}
                    {now}
                    onundone={() => invalidateAll()}
                  />
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

      <Comments entityType="task" entityId={task.id} timeZone={data.timeZone} />
    </div>

    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.task_schedule()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4 text-sm">
          <p class="font-medium text-pretty">
            <TriggerSummary trigger={task.trigger} />
          </p>
          <dl class="grid gap-3">
            {#if taskState}
              <div>
                <dt class="text-muted-foreground text-xs">{m.task_due()}</dt>
                <dd class="mt-0.5 tabular-nums">
                  {#if taskState.dueDate}
                    {formatDateShort(taskState.dueDate, { today })}
                  {:else if taskState.estimate}
                    ~ {formatDateShort(taskState.estimate.date, { today })}
                    <span class="text-muted-foreground">
                      ({taskState.estimate.confidence === "medium"
                        ? m.task_estimate_medium()
                        : m.task_estimate_low()})
                    </span>
                  {:else}
                    {m.task_due_none()}
                  {/if}
                </dd>
              </div>
              {#if taskState.progress}
                <div>
                  <dt class="text-muted-foreground text-xs">
                    {m.task_progress()}
                  </dt>
                  <dd class="mt-1">
                    <ProgressBar
                      current={taskState.progress.current}
                      target={taskState.progress.target}
                      unit={taskState.progress.unit}
                    />
                  </dd>
                </div>
              {/if}
            {/if}
            <div>
              <dt class="text-muted-foreground text-xs">
                {m.task_grace_days()}
              </dt>
              <dd class="mt-0.5">{m.task_days({ days: task.graceDays })}</dd>
            </div>
            {#if task.dueSoonDays !== null}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.task_due_soon_days()}
                </dt>
                <dd class="mt-0.5">
                  {m.task_days({ days: task.dueSoonDays })}
                </dd>
              </div>
            {/if}
          </dl>
          {#if reasons.length > 0}
            <ul class="text-muted-foreground list-disc ps-4 text-xs">
              {#each reasons as reason (reason)}
                <li>{reasonLabels[reason]()}</li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.task_assignment()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-3 text-sm">
          {#if task.assignMode === "none"}
            <p class="text-muted-foreground">{m.task_assignment_none()}</p>
          {:else if task.assignMode === "fixed"}
            <p class="flex items-center gap-2">
              <AssigneeAvatar
                name={task.assigneeUserId
                  ? (people.get(task.assigneeUserId) ?? null)
                  : null}
                id={task.assigneeUserId}
                size="md"
              />
              {m.task_assignment_fixed({
                name: task.assigneeUserId
                  ? (people.get(task.assigneeUserId) ?? "?")
                  : "?",
              })}
            </p>
          {:else}
            <p class="text-pretty">
              {m.task_assignment_rotate({ names: rotation.join(" → ") })}
              <span class="text-muted-foreground">
                ({rotationLabels[task.rotationStrategy]()})
              </span>
            </p>
            {#if currentAssignee && taskState?.currentAssigneeUserId}
              <p class="flex items-center gap-2">
                <AssigneeAvatar
                  name={currentAssignee}
                  id={taskState.currentAssigneeUserId}
                  size="md"
                />
                {m.task_assignment_current({ name: currentAssignee })}
              </p>
            {/if}
          {/if}
          <p class="text-muted-foreground text-xs">
            {m.task_notify()}: {notifyModeLabels[task.notifyMode]()}
          </p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.task_details()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-3 text-sm">
            {#if place.roomName || task.assetName}
              <div>
                <dt class="text-muted-foreground text-xs">
                  {m.task_location()}
                </dt>
                <dd class="mt-0.5">
                  {#if place.roomName && place.roomId}
                    <a
                      href={roomHref(place.roomId)}
                      class="focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                      >{place.roomName}</a
                    >
                  {/if}
                  {#if place.roomName && task.assetName}
                    <span class="mx-1" aria-hidden="true">·</span>
                  {/if}
                  {#if task.assetName && task.assetId}
                    <a
                      href={assetHref(task.assetId)}
                      class="focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                      >{task.assetName}</a
                    >
                  {/if}
                </dd>
              </div>
            {/if}
            {#if task.effortMinutes}
              <div>
                <dt class="text-muted-foreground text-xs">{m.task_effort()}</dt>
                <dd class="mt-0.5">
                  {m.task_minutes({ minutes: task.effortMinutes })}
                </dd>
              </div>
            {/if}
            <div>
              <dt class="text-muted-foreground text-xs">{m.task_created()}</dt>
              <dd class="mt-0.5">
                {formatDateTime(task.createdAt, { timeZone: data.timeZone })}
              </dd>
            </div>
          </dl>
        </Card.Content>
      </Card.Root>
    </div>
  </div>
</div>

{#if dialog}
  <TaskActionDialog
    bind:open={dialogOpen}
    mode={dialog}
    {task}
    {today}
    timeZone={data.timeZone}
  />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.task_delete_title()}
  description={m.task_delete_description({ title: task.title })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
