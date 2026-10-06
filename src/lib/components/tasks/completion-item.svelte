<script lang="ts">
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { UNDO_WINDOW_DAYS, type Completion } from "$lib/api/schemas/tasks";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { sourceIcons, sourceLabels } from "$lib/tasks/labels";
  import AssigneeAvatar from "./assignee-avatar.svelte";

  let {
    completion,
    showTask = false,
    undoable = false,
    timeZone,
    now = Date.now(),
    onundone,
  }: {
    completion: Completion;
    /** Name the task (for lists that mix tasks). */
    showTask?: boolean;
    /** Offer "Undo" while the 7-day window is open. */
    undoable?: boolean;
    timeZone?: string | undefined;
    now?: number;
    onundone?: () => void | Promise<void>;
  } = $props();

  const Icon = $derived(sourceIcons[completion.source]);
  const skipped = $derived(completion.kind === "skipped");
  const canUndo = $derived(
    undoable &&
      completion.revokedAt === null &&
      now - new Date(completion.createdAt).getTime() <
        UNDO_WINDOW_DAYS * 86_400_000,
  );
  const who = $derived(completion.userName ?? m.completion_unknown_user());

  let pending = $state(false);

  async function undo() {
    if (pending) return;
    pending = true;
    try {
      await api.call(endpoints.completionsUndo, {
        params: { id: completion.id },
      });
      toast.success(m.toast_undone());
      await onundone?.();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      pending = false;
    }
  }
</script>

<div class="flex items-start gap-3 py-3">
  <AssigneeAvatar name={completion.userName} id={completion.userId} size="md" />
  <div class="min-w-0 flex-1">
    <p class="text-sm text-pretty break-words">
      <span class="font-medium">{who}</span>
      {#if showTask}
        <span class="text-muted-foreground mx-1" aria-hidden="true">·</span>
        <a
          href={taskHref(completion.taskId)}
          class="focus-visible:ring-ring/50 rounded outline-none hover:underline focus-visible:ring-[3px]"
          >{completion.taskTitle}</a
        >
      {/if}
      {#if skipped}
        <Badge variant="secondary" class="ms-1.5 align-middle"
          >{m.completion_skipped()}</Badge
        >
      {/if}
    </p>
    <p
      class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs"
    >
      <time
        datetime={completion.completedAt}
        title={formatDateTime(completion.completedAt, {
          ...(timeZone ? { timeZone } : {}),
        })}>{formatRelativeInstant(completion.completedAt, now)}</time
      >
      <span class="inline-flex items-center gap-1">
        <Icon class="size-3.5" aria-hidden="true" />
        {sourceLabels[completion.source]()}
      </span>
    </p>
    {#if completion.note}
      <p class="mt-1.5 text-sm text-pretty break-words whitespace-pre-wrap">
        {completion.note}
      </p>
    {/if}
  </div>
  {#if canUndo}
    <Button
      variant="ghost"
      size="sm"
      class="h-10 shrink-0"
      disabled={pending}
      onclick={undo}
      aria-label={m.completion_undo_aria({ who })}
    >
      <Undo2Icon />
      {m.toast_undo()}
    </Button>
  {/if}
</div>
