<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import FileQuestionIcon from "@lucide/svelte/icons/file-question";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { resolve } from "$app/paths";
  import type { AiTask } from "$lib/api/schemas/ai-tasks";
  import { contentHref } from "$lib/attachments/files";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    closedViaLabel,
    isImageTask,
    statusLabels,
    taskThumbSrc,
  } from "$lib/costs/receipts";
  import { formatDateTime, formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import CostAmount from "./cost-amount.svelte";

  let {
    task,
    timeZone,
    canDismiss,
    canDelete,
    onopen,
    ondismiss,
    ondelete,
  }: {
    task: AiTask;
    timeZone: string;
    /** The person may close a task that waits without booking anything. */
    canDismiss: boolean;
    canDelete: boolean;
    /** The picture was tapped: open it large. */
    onopen: (task: AiTask) => void;
    ondismiss: (task: AiTask) => void;
    ondelete: (task: AiTask) => void;
  } = $props();

  const thumb = $derived(taskThumbSrc(task));
  const costs = $derived(task.result?.costs ?? []);
  const via = $derived(closedViaLabel(task.completedVia));
  const hints = $derived(
    [
      task.bookName ? m.receipts_hint_book({ name: task.bookName }) : "",
      task.assetName ? m.receipts_hint_asset({ name: task.assetName }) : "",
    ].filter(Boolean),
  );
  const closedAt = $derived(
    task.completedAt
      ? formatDateTime(task.completedAt, { timeZone })
      : undefined,
  );
  const tile =
    "bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border sm:size-20";
  const tileLink =
    "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px] hover:opacity-90";
</script>

<li class="flex flex-col gap-3 px-4 py-4">
  <div class="flex items-start gap-3">
    {#if thumb}
      <button
        type="button"
        class={cn(tile, tileLink, "p-0")}
        aria-label={m.receipts_open_file()}
        onclick={() => onopen(task)}
      >
        <img src={thumb} alt="" loading="lazy" class="size-full object-cover" />
      </button>
    {:else if task.attachment}
      <!-- eslint-disable svelte/no-navigation-without-resolve -- the address of a file is the API's own path, resolved here -->
      <a
        href={contentHref(task.attachment)}
        target="_blank"
        rel="noopener noreferrer"
        class={cn(tile, tileLink)}
        aria-label={m.receipts_open_file()}
      >
        <FileTextIcon class="size-7" aria-hidden="true" />
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {:else}
      <span class={tile} title={m.receipts_no_file()}>
        <FileQuestionIcon class="size-7" aria-hidden="true" />
        <span class="sr-only">{m.receipts_no_file()}</span>
      </span>
    {/if}

    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        {#if task.status === "pending"}
          <Badge variant="outline" class="border-warning/50 text-warning">
            <ClockIcon aria-hidden="true" />{statusLabels.pending()}
          </Badge>
        {:else if task.status === "done"}
          <Badge variant="outline" class="border-success/40 text-success">
            <CircleCheckIcon aria-hidden="true" />{statusLabels.done()}
          </Badge>
        {:else}
          <Badge variant="secondary">
            <BanIcon aria-hidden="true" />{statusLabels.dismissed()}
          </Badge>
        {/if}
        <span class="text-muted-foreground text-xs tabular-nums">
          {formatDateTime(task.createdAt, { timeZone })}
        </span>
      </div>
      <p class="text-muted-foreground text-xs wrap-anywhere">
        {task.createdByName
          ? m.receipts_by({ name: task.createdByName })
          : m.receipts_by_unknown()}
      </p>
      {#if task.note}
        <p class="text-sm text-pretty wrap-anywhere whitespace-pre-line">
          {task.note}
        </p>
      {/if}
      {#if hints.length > 0}
        <p class="text-muted-foreground text-xs wrap-anywhere">
          {hints.join(" · ")}
        </p>
      {/if}
      {#if task.attachment && !isImageTask(task)}
        <!-- eslint-disable svelte/no-navigation-without-resolve -- the address of a file is the API's own path, resolved here -->
        <a
          href={contentHref(task.attachment)}
          target="_blank"
          rel="noopener noreferrer"
          class="text-foreground focus-visible:ring-ring/50 inline-flex min-h-10 w-fit items-center gap-1.5 rounded text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
        >
          <ExternalLinkIcon class="size-4" aria-hidden="true" />
          {m.receipts_open_pdf()}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {/if}
    </div>
  </div>

  {#if task.status === "done" && task.result}
    <div class="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3">
      <h3 class="text-xs font-semibold">{m.receipts_result_title()}</h3>
      {#if costs.length > 0}
        <ul class="flex flex-col divide-y">
          {#each costs as cost (cost.id)}
            <li class="py-1.5 first:pt-0 last:pb-0">
              <a
                href={resolve(`/costs/${cost.id}` as "/")}
                class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-11 items-start justify-between gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:ring-[3px]"
              >
                <span class="min-w-0">
                  <span class="block text-sm font-medium wrap-anywhere"
                    >{cost.title}</span
                  >
                  <span
                    class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                  >
                    <span class="tabular-nums">{formatDay(cost.date)}</span>
                    {#if cost.reviewNeeded}
                      <Badge
                        variant="outline"
                        class="border-warning/50 text-warning"
                      >
                        <EyeIcon aria-hidden="true" />{m.cost_badge_review()}
                      </Badge>
                    {/if}
                  </span>
                </span>
                <CostAmount
                  amountMinor={cost.amountMinor}
                  currency={cost.currency}
                  class="shrink-0 text-sm font-medium"
                />
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.receipts_result_gone()}
        </p>
      {/if}
      {#if task.result.note}
        <p class="text-xs text-pretty wrap-anywhere whitespace-pre-line">
          <span class="font-medium">{m.receipts_result_note()}:</span>
          {task.result.note}
        </p>
      {/if}
    </div>
  {/if}

  {#if task.status !== "pending"}
    <p class="text-muted-foreground text-xs text-pretty wrap-anywhere">
      {[closedAt, via].filter(Boolean).join(" · ")}
      {#if task.status === "dismissed"}
        {#if task.dismissReason}
          <span class="block"
            >{m.receipts_dismissed_reason({ reason: task.dismissReason })}</span
          >
        {/if}
      {/if}
    </p>
  {/if}

  {#if (task.status === "pending" && canDismiss) || canDelete}
    <div class="flex flex-wrap items-center gap-2">
      {#if task.status === "pending" && canDismiss}
        <Button variant="outline" size="lg" onclick={() => ondismiss(task)}>
          <BanIcon />
          {m.receipts_dismiss()}
        </Button>
      {/if}
      {#if canDelete}
        <Button
          variant="ghost"
          size="lg"
          class="text-destructive hover:text-destructive"
          onclick={() => ondelete(task)}
        >
          <Trash2Icon />
          {m.common_delete()}
        </Button>
      {/if}
    </div>
  {/if}
</li>
