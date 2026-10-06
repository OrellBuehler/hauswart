<script lang="ts">
  import AlarmClockIcon from "@lucide/svelte/icons/alarm-clock";
  import AlarmClockOffIcon from "@lucide/svelte/icons/alarm-clock-off";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import SkipForwardIcon from "@lucide/svelte/icons/skip-forward";
  import { toast } from "svelte-sonner";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { assetHref, roomHref, taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { snoozeTask } from "$lib/tasks/actions";
  import type { TaskRowData } from "$lib/tasks/row";
  import { cn } from "$lib/utils";
  import AssigneeAvatar from "./assignee-avatar.svelte";
  import CompleteButton from "./complete-button.svelte";
  import DueBadge from "./due-badge.svelte";
  import ProgressBar from "./progress-bar.svelte";
  import StatusDot from "./status-dot.svelte";
  import TaskActionDialog from "./task-action-dialog.svelte";

  let {
    task,
    today,
    onstart,
    onfail,
    onsettled,
    class: className,
  }: {
    task: TaskRowData;
    today: string;
    onstart?: () => void;
    onfail?: () => void;
    onsettled?: () => void;
    class?: string;
  } = $props();

  let dialog = $state<"skip" | "snooze" | null>(null);
  let dialogOpen = $state(false);

  function openDialog(mode: "skip" | "snooze") {
    dialog = mode;
    dialogOpen = true;
  }

  async function unsnooze() {
    try {
      await snoozeTask(task, null, task.snoozedUntil);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const place = $derived(
    [
      task.roomName
        ? {
            name: task.roomName,
            href: task.roomId ? roomHref(task.roomId) : null,
          }
        : null,
      task.assetName
        ? {
            name: task.assetName,
            href: task.assetId ? assetHref(task.assetId) : null,
          }
        : null,
    ].filter((p) => p !== null),
  );
</script>

<div
  class={cn(
    "flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:gap-4",
    className,
  )}
>
  <div class="flex min-w-0 flex-1 gap-3">
    <StatusDot status={task.status} class="mt-1.5" />
    <div class="min-w-0 flex-1">
      <a
        href={taskHref(task.id)}
        class="focus-visible:ring-ring/50 -mx-1 rounded px-1 font-medium text-pretty break-words outline-none hover:underline focus-visible:ring-[3px]"
      >
        {task.title}
      </a>
      {#if place.length > 0}
        <p class="text-muted-foreground mt-0.5 text-xs">
          {#each place as p, i (p.name)}
            {#if i > 0}<span class="mx-1" aria-hidden="true">·</span>{/if}
            {#if p.href}
              <a
                href={p.href}
                class="focus-visible:ring-ring/50 rounded outline-none hover:underline focus-visible:ring-[3px]"
                >{p.name}</a
              >
            {:else}
              {p.name}
            {/if}
          {/each}
        </p>
      {/if}
      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <DueBadge
          status={task.status}
          date={task.date}
          estimated={task.estimated}
          {today}
        />
        <CommentCount count={task.commentCount ?? 0} />
        {#if task.assigneeUserId}
          <span
            class="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
          >
            <AssigneeAvatar name={task.assigneeName} id={task.assigneeUserId} />
            <span class="max-w-32 truncate">{task.assigneeName}</span>
          </span>
        {/if}
      </div>
      {#if task.progress}
        <ProgressBar
          class="mt-2 max-w-xs"
          current={task.progress.current}
          target={task.progress.target}
          unit={task.progress.unit}
        />
      {/if}
    </div>
  </div>
  {#if !task.archived}
    <div class="flex items-center gap-1.5 sm:shrink-0">
      <CompleteButton
        {task}
        class="flex-1 sm:flex-none"
        {onstart}
        {onfail}
        {onsettled}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              aria-label={m.task_menu_aria({ title: task.title })}
            >
              <EllipsisIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-48">
          <DropdownMenu.Item
            class="min-h-10"
            onSelect={() => openDialog("skip")}
          >
            <SkipForwardIcon />
            {m.task_skip()}
          </DropdownMenu.Item>
          {#if task.status === "snoozed" && task.snoozedUntil}
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
          <DropdownMenu.Item class="min-h-10">
            {#snippet child({ props })}
              <a href={taskHref(task.id)} {...props}>
                <ExternalLinkIcon />
                {m.task_open()}
              </a>
            {/snippet}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {/if}
</div>

{#if dialog}
  <TaskActionDialog bind:open={dialogOpen} mode={dialog} {task} {today} />
{/if}
