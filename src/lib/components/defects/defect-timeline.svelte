<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import FlagIcon from "@lucide/svelte/icons/flag";
  import MailIcon from "@lucide/svelte/icons/mail";
  import MessageSquarePlusIcon from "@lucide/svelte/icons/message-square-plus";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import RefreshCcwIcon from "@lucide/svelte/icons/refresh-ccw";
  import type { Comment } from "$lib/api/schemas/comments";
  import type { DefectTimelineItem } from "$lib/api/schemas/defects";
  import CommentBody from "$lib/components/comments/comment-body.svelte";
  import CommentComposer from "$lib/components/comments/comment-composer.svelte";
  import CommentItem from "$lib/components/comments/comment-item.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import DefectCorrespondenceDialog from "./defect-correspondence-dialog.svelte";
  import DefectStatusBadge from "./defect-status-badge.svelte";

  let {
    defectId,
    items,
    comments,
    timeZone,
  }: {
    defectId: string;
    items: DefectTimelineItem[];
    /** The defect's comments by id: the timeline itself does not say who may edit them. */
    comments: Map<string, Comment>;
    timeZone: string;
  } = $props();

  let correspondenceOpen = $state(false);
  const now = Date.now();

  const refresh = () => invalidateAll();

  function commentOf(
    item: Extract<DefectTimelineItem, { kind: "comment" }>,
  ): Comment {
    return (
      comments.get(item.id) ?? {
        id: item.id,
        entityType: "defect",
        entityId: defectId,
        author: item.userId
          ? { id: item.userId, displayName: item.userName ?? "" }
          : null,
        bodyMd: item.bodyMd,
        createdAt: item.at,
        editedAt: item.editedAt,
        deleted: item.deleted,
        canEdit: false,
        canDelete: false,
      }
    );
  }

  function actor(userName: string | null): string {
    return userName ?? m.defect_event_unknown_user();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-base">{m.defect_timeline()}</Card.Title>
    <Card.Action>
      <Button
        variant="outline"
        size="sm"
        onclick={() => (correspondenceOpen = true)}
      >
        <MailIcon />{m.defect_correspondence_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <ol class="flex flex-col" aria-label={m.defect_timeline()}>
      {#each items as item, index (`${item.kind}-${item.id}`)}
        {@const last = index === items.length - 1}
        <li class={cn("relative flex gap-3", !last && "pb-6")}>
          {#if !last}
            <span
              class="bg-border absolute start-4 top-9 bottom-1 w-px -translate-x-1/2"
              aria-hidden="true"
            ></span>
          {/if}
          {#if item.kind === "comment"}
            <div class="min-w-0 flex-1">
              <CommentItem
                comment={commentOf(item)}
                {now}
                {timeZone}
                onchanged={refresh}
              />
            </div>
          {:else}
            <span
              class="bg-muted text-muted-foreground relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
              aria-hidden="true"
            >
              {#if item.type === "correspondence"}
                <MailIcon class="size-4" />
              {:else if item.type === "status"}
                <RefreshCcwIcon class="size-4" />
              {:else if item.type === "comment"}
                <MessageSquareIcon class="size-4" />
              {:else}
                <FlagIcon class="size-4" />
              {/if}
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <span class="font-medium wrap-anywhere">
                  {#if item.type === "correspondence"}
                    {m.defect_event_correspondence({
                      user: actor(item.userName),
                    })}
                  {:else if item.type === "status"}
                    {m.defect_event_status({ user: actor(item.userName) })}
                  {:else if item.type === "created"}
                    {m.defect_event_created({ user: actor(item.userName) })}
                  {:else}
                    {m.defect_event_comment({ user: actor(item.userName) })}
                  {/if}
                </span>
                <time
                  class="text-muted-foreground text-xs max-sm:basis-full"
                  datetime={item.at}
                  title={formatDateTime(item.at, { timeZone })}
                >
                  {formatRelativeInstant(item.at, now)}
                  <span class="tabular-nums sm:hidden"
                    >· {formatDateTime(item.at, { timeZone })}</span
                  >
                </time>
              </p>
              {#if item.type === "status" && item.toStatus}
                <p class="mt-1.5 flex flex-wrap items-center gap-2">
                  {#if item.fromStatus}
                    <DefectStatusBadge status={item.fromStatus} />
                    <ArrowRightIcon
                      class="text-muted-foreground size-3.5 rtl:rotate-180"
                      aria-label={m.defect_event_to()}
                    />
                  {/if}
                  <DefectStatusBadge status={item.toStatus} />
                </p>
              {/if}
              {#if item.bodyMd}
                <CommentBody text={item.bodyMd} class="mt-1.5" />
              {/if}
              {#if item.externalRef}
                <div
                  class="text-muted-foreground mt-1.5 flex flex-wrap gap-x-1 text-xs"
                >
                  <span>{m.defect_event_reference()}:</span>
                  <CommentBody
                    text={item.externalRef}
                    class="min-w-0 text-xs wrap-anywhere"
                  />
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <div class="border-t pt-5">
      <h3 class="mb-3 flex items-center gap-2 text-sm font-medium">
        <MessageSquarePlusIcon
          class="text-muted-foreground size-4"
          aria-hidden="true"
        />
        {m.defect_comment_add()}
      </h3>
      <CommentComposer
        entityType="defect"
        entityId={defectId}
        id="defect-comment"
        oncreated={refresh}
      />
    </div>
  </Card.Content>
</Card.Root>

<DefectCorrespondenceDialog bind:open={correspondenceOpen} {defectId} />
