<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ReceiptTextIcon from "@lucide/svelte/icons/receipt-text";
  import { untrack } from "svelte";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { isApiError } from "$lib/api/errors";
  import { endpoints } from "$lib/api/registry";
  import { AI_TASK_REASON_MAX, type AiTask } from "$lib/api/schemas/ai-tasks";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Fab from "$lib/components/app/fab.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import AttachmentLightbox from "$lib/components/attachments/attachment-lightbox.svelte";
  import ReceiptTask from "$lib/components/costs/receipt-task.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    RECEIPTS_PAGE_SIZE,
    RECEIPT_VIEWS,
    appendTasks,
    canDeleteTask,
    isImageTask,
    receiptViewQuery,
    receiptViewStatus,
    type ReceiptView,
  } from "$lib/costs/receipts";
  import { apiErrorMessage } from "$lib/error-message";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));

  // Further pages are fetched here and dropped whenever the page loads again.
  let more = $state.raw<AiTask[]>([]);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  let moreError = $state<string | undefined>();
  $effect(() => {
    const next = data.nextCursor;
    void data.tasks;
    untrack(() => {
      more = [];
      cursor = next;
      moreError = undefined;
    });
  });

  const tasks = $derived(appendTasks(data.tasks, more));
  const viewLabels: Record<ReceiptView, () => string> = {
    all: () => m.receipts_filter_all(),
    pending: () => m.receipts_status_pending(),
    done: () => m.receipts_status_done(),
    dismissed: () => m.receipts_status_dismissed(),
  };

  const emptyTitles: Record<ReceiptView, () => string> = {
    all: () => m.receipts_empty_title(),
    pending: () => m.receipts_empty_pending_title(),
    done: () => m.receipts_empty_done_title(),
    dismissed: () => m.receipts_empty_dismissed_title(),
  };

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    moreError = undefined;
    try {
      const status = receiptViewStatus(data.view);
      const page = await api.call(endpoints.aiTasksList, {
        query: {
          limit: RECEIPTS_PAGE_SIZE,
          cursor,
          ...(status ? { status } : {}),
        },
      });
      more = appendTasks(more, page.items);
      cursor = page.nextCursor;
    } catch (err) {
      moreError = apiErrorMessage(err);
    } finally {
      loadingMore = false;
    }
  }

  const lightboxImages = $derived(
    tasks.flatMap((task) =>
      task.attachment && isImageTask(task) ? [task.attachment] : [],
    ) as Attachment[],
  );
  let lightbox = $state<number | null>(null);

  function openFile(task: AiTask) {
    const index = lightboxImages.findIndex((a) => a.id === task.attachment?.id);
    if (index >= 0) lightbox = index;
  }

  let dismissTarget = $state<AiTask | undefined>();
  let dismissOpen = $state(false);
  let reason = $state("");

  function askDismiss(task: AiTask) {
    dismissTarget = task;
    reason = "";
    dismissOpen = true;
  }

  async function dismiss() {
    const task = dismissTarget;
    if (!task) return;
    const text = reason.trim();
    if (text.length > AI_TASK_REASON_MAX) {
      return m.field_too_long({ max: AI_TASK_REASON_MAX });
    }
    try {
      await api.call(endpoints.aiTasksDismiss, {
        params: { id: task.id },
        body: text ? { reason: text } : {},
      });
    } catch (err) {
      if (isApiError(err) && err.code === "conflict") {
        // somebody booked it in the meantime: show what it is now
        await invalidateAfterOverlay();
        return m.receipts_conflict();
      }
      throw err;
    }
    toast.success(m.receipts_dismissed_toast());
    await invalidateAfterOverlay();
  }

  let deleteTarget = $state<AiTask | undefined>();
  let deleteOpen = $state(false);

  function askDelete(task: AiTask) {
    deleteTarget = task;
    deleteOpen = true;
  }

  async function remove() {
    const task = deleteTarget;
    if (!task) return;
    await api.call(endpoints.aiTasksDelete, { params: { id: task.id } });
    toast.success(m.receipts_deleted_toast());
    await invalidateAfterOverlay();
  }

  const submitHref = resolve("/costs/quick?mode=receipt" as "/");
  const chip =
    "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11";
</script>

<svelte:head>
  <title>{m.receipts_title()} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.cost_back()}
    </a>
  </div>

  <PageHeader title={m.receipts_title()} description={m.receipts_description()}>
    {#snippet actions()}
      {#if canWrite}
        <Button href={submitHref} size="lg" class="max-md:hidden">
          <PlusIcon />
          {m.receipts_submit()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <p
    class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm text-pretty"
  >
    <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0">{m.receipts_explainer()}</span>
  </p>

  <nav aria-label={m.receipts_filter_label()}>
    <ul class="flex flex-wrap items-center gap-2">
      {#each RECEIPT_VIEWS as view (view)}
        {@const current = view === data.view}
        <li>
          <a
            href={resolve(`/costs/receipts${receiptViewQuery(view)}` as "/")}
            aria-current={current ? "true" : undefined}
            class={cn(
              chip,
              current
                ? "border-brand bg-brand text-brand-foreground"
                : "bg-card hover:bg-accent",
            )}
          >
            {viewLabels[view]()}
            {#if view === "pending" && data.pendingCount > 0}
              <span
                class={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  current
                    ? "bg-brand-foreground/20"
                    : "bg-warning/15 text-warning",
                )}
                aria-hidden="true">{data.pendingCount}</span
              >
              <span class="sr-only"
                >{m.receipts_pending_count({ count: data.pendingCount })}</span
              >
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  {#if tasks.length === 0}
    {#if data.view === "all"}
      <EmptyState
        icon={ReceiptTextIcon}
        title={m.receipts_empty_title()}
        description={m.receipts_empty_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            <Button href={submitHref}>
              <PlusIcon />
              {m.receipts_submit()}
            </Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon={ReceiptTextIcon}
        title={emptyTitles[data.view]()}
        description={data.view === "pending"
          ? m.receipts_empty_pending_body()
          : m.receipts_empty_filtered_body()}
      >
        {#snippet actions()}
          <Button href={resolve("/costs/receipts")} variant="outline">
            {m.receipts_filter_all()}
          </Button>
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
      {m.receipts_count({ count: tasks.length })}{cursor ? "+" : ""}
    </p>
    <Card.Root class="gap-0 py-0">
      <ul class="divide-y">
        {#each tasks as task (task.id)}
          <ReceiptTask
            {task}
            timeZone={data.timeZone}
            canDismiss={canWrite}
            canDelete={canWrite && canDeleteTask(task, data.user)}
            onopen={openFile}
            ondismiss={askDismiss}
            ondelete={askDelete}
          />
        {/each}
      </ul>
    </Card.Root>
    {#if cursor}
      <div class="flex flex-col items-center gap-3">
        <FormAlert message={moreError} />
        <Button
          variant="outline"
          size="lg"
          disabled={loadingMore}
          onclick={loadMore}
        >
          {#if loadingMore}
            <LoaderCircleIcon class="animate-spin" />{m.common_loading()}
          {:else}
            {m.common_load_more()}
          {/if}
        </Button>
      </div>
    {/if}
  {/if}
</div>

{#if canWrite}
  <Fab href={submitHref} label={m.receipts_submit()} />
{/if}

<AttachmentLightbox images={lightboxImages} bind:index={lightbox} />

<FormDialog
  bind:open={dismissOpen}
  title={m.receipts_dismiss_title()}
  description={m.receipts_dismiss_description()}
  submitLabel={m.receipts_dismiss()}
  pendingLabel={m.receipts_dismissing()}
  onsubmit={dismiss}
>
  <Field
    id="dismiss-reason"
    label={m.receipts_dismiss_reason()}
    optional
    hint={m.receipts_dismiss_reason_hint()}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="dismiss-reason"
        rows={3}
        maxlength={AI_TASK_REASON_MAX}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={reason}
      />
    {/snippet}
  </Field>
</FormDialog>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.receipts_delete_title()}
  description={deleteTarget?.status === "done"
    ? m.receipts_delete_description_done()
    : m.receipts_delete_description()}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
