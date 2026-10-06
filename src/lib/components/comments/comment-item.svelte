<script lang="ts">
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { COMMENT_MAX_LENGTH, type Comment } from "$lib/api/schemas/comments";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import AssigneeAvatar from "$lib/components/tasks/assignee-avatar.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import CommentBody from "./comment-body.svelte";

  let {
    comment,
    now = Date.now(),
    timeZone,
    onchanged,
  }: {
    comment: Comment;
    now?: number;
    timeZone?: string | undefined;
    /** Called with the comment after it was edited or deleted. */
    onchanged: (comment: Comment) => void | Promise<void>;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();
  let deleteOpen = $state(false);

  const author = $derived(
    comment.author?.displayName || m.comments_unknown_author(),
  );
  const absolute = $derived(
    formatDateTime(comment.createdAt, timeZone ? { timeZone } : {}),
  );

  function startEdit() {
    draft = comment.bodyMd;
    error = undefined;
    editing = true;
  }

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    const bodyMd = draft.trim();
    if (pending || bodyMd === "") return;
    if (bodyMd === comment.bodyMd) {
      editing = false;
      return;
    }
    pending = true;
    error = undefined;
    try {
      const updated = await api.call(endpoints.commentsUpdate, {
        params: { id: comment.id },
        body: { bodyMd },
      });
      editing = false;
      await onchanged(updated);
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
    }
  }

  async function remove() {
    await api.call(endpoints.commentsDelete, { params: { id: comment.id } });
    await onchanged({
      ...comment,
      bodyMd: "",
      deleted: true,
      canEdit: false,
      canDelete: false,
    });
  }
</script>

<div class="flex gap-3">
  <AssigneeAvatar
    name={comment.author?.displayName ?? null}
    id={comment.author?.id ?? null}
    size="md"
    class="mt-0.5"
  />
  <div class="min-w-0 flex-1">
    <div class="flex items-start justify-between gap-2">
      <p class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span class="font-medium break-words">{author}</span>
        <time
          class="text-muted-foreground text-xs"
          datetime={comment.createdAt}
          title={absolute}>{formatRelativeInstant(comment.createdAt, now)}</time
        >
        {#if comment.editedAt && !comment.deleted}
          <span
            class="text-muted-foreground text-xs"
            title={formatDateTime(
              comment.editedAt,
              timeZone ? { timeZone } : {},
            )}>({m.comments_edited()})</span
          >
        {/if}
      </p>
      {#if !editing && (comment.canEdit || comment.canDelete)}
        <div class="-me-2 -mt-1.5 flex shrink-0 items-center">
          {#if comment.canEdit}
            <Button
              variant="ghost"
              size="icon-lg"
              class="text-muted-foreground size-9"
              aria-label={m.comments_edit()}
              onclick={startEdit}
            >
              <PencilIcon />
            </Button>
          {/if}
          {#if comment.canDelete}
            <Button
              variant="ghost"
              size="icon-lg"
              class="text-muted-foreground hover:text-destructive size-9"
              aria-label={m.comments_delete()}
              onclick={() => (deleteOpen = true)}
            >
              <Trash2Icon />
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    {#if comment.deleted}
      <p class="text-muted-foreground mt-1 text-sm italic">
        {m.comments_deleted()}
      </p>
    {:else if editing}
      <form class="mt-2 flex flex-col gap-2" onsubmit={save}>
        <label for={`edit-${comment.id}`} class="sr-only"
          >{m.comments_edit_label()}</label
        >
        <Textarea
          id={`edit-${comment.id}`}
          rows={3}
          maxlength={COMMENT_MAX_LENGTH}
          disabled={pending}
          bind:value={draft}
          {onkeydown}
        />
        <FormAlert message={error} />
        <div class="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onclick={() => (editing = false)}
          >
            {m.common_cancel()}
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={pending || draft.trim() === ""}
          >
            {#if pending}
              <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
            {:else}
              {m.common_save()}
            {/if}
          </Button>
        </div>
      </form>
    {:else}
      <CommentBody text={comment.bodyMd} class="mt-1" />
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.comments_delete_title()}
  description={m.comments_delete_description()}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
