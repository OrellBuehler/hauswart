<script lang="ts">
  import CpuIcon from "@lucide/svelte/icons/cpu";
  import DoorOpenIcon from "@lucide/svelte/icons/door-open";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import PinIcon from "@lucide/svelte/icons/pin";
  import type { DocPageSummary } from "$lib/api/schemas/docs";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { sectionIcons, sectionLabels } from "$lib/docs/sections";
  import { docHref } from "$lib/docs/links";
  import { formatDate } from "$lib/format";
  import { m } from "$lib/paraglide/messages";

  let {
    page,
    assetName,
    roomName,
    showSection = false,
  }: {
    page: DocPageSummary;
    assetName?: string | null | undefined;
    roomName?: string | null | undefined;
    /** Names the section as a badge (flat result lists); grouped lists have it as the heading. */
    showSection?: boolean;
  } = $props();

  const Icon = $derived(sectionIcons[page.section]);
</script>

<li>
  <a
    href={docHref(page.slug)}
    class="hover:bg-accent/50 focus-visible:ring-ring/50 flex items-start gap-3 px-4 py-3.5 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px]"
  >
    <span
      class="bg-muted text-muted-foreground mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Icon class="size-4.5" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-2">
        <span class="truncate text-sm font-medium">{page.title}</span>
        {#if page.pinned}
          <PinIcon
            class="text-brand size-3.5 shrink-0 fill-current"
            aria-label={m.docs_pinned()}
          />
        {/if}
        <CommentCount count={page.commentCount} class="shrink-0" />
        {#if page.archivedAt}
          <Badge variant="secondary" class="shrink-0">{m.docs_archived()}</Badge
          >
        {/if}
      </span>
      {#if page.excerpt}
        <span
          class="text-muted-foreground mt-0.5 line-clamp-2 text-xs text-pretty"
        >
          {page.excerpt}
        </span>
      {/if}
      <span
        class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      >
        {#if showSection}
          <Badge variant="secondary">{sectionLabels[page.section]()}</Badge>
        {/if}
        {#if assetName}
          <span class="inline-flex min-w-0 items-center gap-1">
            <CpuIcon class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{assetName}</span>
          </span>
        {/if}
        {#if roomName}
          <span class="inline-flex min-w-0 items-center gap-1">
            <DoorOpenIcon class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{roomName}</span>
          </span>
        {/if}
        {#if page.guestVisible}
          <span class="inline-flex items-center gap-1">
            <EyeIcon
              class="size-3"
              aria-hidden="true"
            />{m.docs_guest_visible_short()}
          </span>
        {/if}
        <span class="tabular-nums">{formatDate(page.updatedAt)}</span>
      </span>
    </span>
  </a>
</li>
