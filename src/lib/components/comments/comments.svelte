<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import { api } from "$lib/api/browser";
  import type { CommentEntityType } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Comment } from "$lib/api/schemas/comments";
  import ErrorBanner from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import CommentComposer from "./comment-composer.svelte";
  import CommentItem from "./comment-item.svelte";

  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;

  let {
    entityType,
    entityId,
    timeZone,
    onchange,
  }: {
    entityType: CommentEntityType;
    entityId: string;
    timeZone?: string | undefined;
    /** Called after a comment was added, edited or deleted. */
    onchange?: () => void;
  } = $props();

  let items = $state.raw<Comment[]>([]);
  let cursor = $state<string | null>(null);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let loadError = $state<string | undefined>();
  let loadingMore = $state(false);
  let moreError = $state<string | undefined>();
  const now = Date.now();
  let generation = 0;

  async function fetchPage(after: string | undefined) {
    return api.call(endpoints.commentsList, {
      query: {
        entityType,
        entityId,
        limit: PAGE_SIZE,
        ...(after ? { cursor: after } : {}),
      },
    });
  }

  async function loadFirst() {
    const current = ++generation;
    phase = "loading";
    loadError = undefined;
    try {
      const page = await fetchPage(undefined);
      if (current !== generation) return;
      items = page.items;
      cursor = page.nextCursor;
      phase = "ready";
    } catch (err) {
      if (current !== generation) return;
      loadError = apiErrorMessage(err);
      phase = "error";
    }
  }

  $effect(() => {
    void entityType;
    void entityId;
    void loadFirst();
  });

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    moreError = undefined;
    const current = generation;
    try {
      const page = await fetchPage(cursor);
      if (current !== generation) return;
      items = [...items, ...page.items];
      cursor = page.nextCursor;
    } catch (err) {
      moreError = apiErrorMessage(err);
    } finally {
      loadingMore = false;
    }
  }

  /** The new comment belongs at the end: when pages are still missing, read them first. */
  async function created(comment: Comment) {
    if (cursor === null) {
      items = [...items, comment];
    } else {
      const current = generation;
      let after: string | null = cursor;
      const rest: Comment[] = [];
      for (let page = 0; after && page < MAX_PAGES; page += 1) {
        const result = await fetchPage(after);
        rest.push(...result.items);
        after = result.nextCursor;
      }
      if (current !== generation) return;
      items = [...items, ...rest];
      cursor = after;
    }
    onchange?.();
  }

  function changed(next: Comment) {
    items = items.map((c) => (c.id === next.id ? next : c));
    onchange?.();
  }

  const count = $derived(items.filter((c) => !c.deleted).length);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <MessageSquareIcon
        class="text-muted-foreground size-4"
        aria-hidden="true"
      />
      {m.comments_title()}
      {#if phase === "ready" && count > 0}
        <span
          class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
          >{count}{cursor ? "+" : ""}</span
        >
      {/if}
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-5">
    {#if phase === "loading"}
      <div
        class="flex flex-col gap-4"
        role="status"
        aria-label={m.common_loading()}
      >
        {#each [0, 1] as row (row)}
          <div class="flex gap-3">
            <Skeleton class="size-8 shrink-0 rounded-full" />
            <div class="flex flex-1 flex-col gap-2">
              <Skeleton class="h-3.5 w-32" />
              <Skeleton class="h-3.5 w-full max-w-sm" />
            </div>
          </div>
        {/each}
      </div>
    {:else if phase === "error"}
      <div class="flex flex-col items-start gap-3">
        <ErrorBanner message={loadError} />
        <Button variant="outline" size="lg" onclick={loadFirst}>
          {m.common_retry()}
        </Button>
      </div>
    {:else}
      {#if items.length === 0}
        <p class="text-muted-foreground text-sm">{m.comments_empty()}</p>
      {:else}
        <ul class="flex flex-col gap-5" aria-label={m.comments_title()}>
          {#each items as comment (comment.id)}
            <li>
              <CommentItem {comment} {now} {timeZone} onchanged={changed} />
            </li>
          {/each}
        </ul>
        {#if cursor}
          <div class="flex flex-col items-center gap-2">
            <ErrorBanner message={moreError} />
            <Button
              variant="outline"
              size="lg"
              disabled={loadingMore}
              onclick={loadMore}
            >
              {#if loadingMore}
                <LoaderCircleIcon class="animate-spin" />
              {/if}
              {m.comments_load_more()}
            </Button>
          </div>
        {/if}
      {/if}
      <div class={items.length > 0 ? "border-t pt-5" : ""}>
        <CommentComposer
          {entityType}
          {entityId}
          id={`comment-composer-${entityType}`}
          oncreated={created}
        />
      </div>
    {/if}
  </Card.Content>
</Card.Root>
