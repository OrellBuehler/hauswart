<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SendIcon from "@lucide/svelte/icons/send";
  import { api } from "$lib/api/browser";
  import type { CommentEntityType } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { COMMENT_MAX_LENGTH, type Comment } from "$lib/api/schemas/comments";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    entityType,
    entityId,
    oncreated,
    id = "comment-composer",
  }: {
    entityType: CommentEntityType;
    entityId: string;
    oncreated: (comment: Comment) => void | Promise<void>;
    id?: string;
  } = $props();

  let body = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  const trimmed = $derived(body.trim());
  const nearLimit = $derived(body.length > COMMENT_MAX_LENGTH - 500);

  async function submit(event?: SubmitEvent) {
    event?.preventDefault();
    if (pending || trimmed === "") return;
    pending = true;
    error = undefined;
    try {
      const comment = await api.call(endpoints.commentsCreate, {
        body: { entityType, entityId, bodyMd: trimmed },
      });
      body = "";
      await oncreated(comment);
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<form class="flex flex-col gap-2" onsubmit={submit}>
  <label for={id} class="sr-only">{m.comments_composer_label()}</label>
  <Textarea
    {id}
    rows={2}
    class="min-h-20"
    maxlength={COMMENT_MAX_LENGTH}
    placeholder={m.comments_composer_placeholder()}
    aria-describedby={`${id}-hint`}
    disabled={pending}
    bind:value={body}
    {onkeydown}
  />
  <FormAlert message={error} />
  <div class="flex items-center justify-between gap-3">
    <p id={`${id}-hint`} class="text-muted-foreground text-xs text-pretty">
      {m.comments_composer_hint()}
      {#if nearLimit}
        <span class="tabular-nums">· {body.length} / {COMMENT_MAX_LENGTH}</span>
      {/if}
    </p>
    <Button type="submit" size="lg" disabled={pending || trimmed === ""}>
      {#if pending}
        <LoaderCircleIcon class="animate-spin" />{m.comments_sending()}
      {:else}
        <SendIcon />{m.comments_send()}
      {/if}
    </Button>
  </div>
</form>
