<script lang="ts">
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import type { DocPageSummary } from "$lib/api/schemas/docs";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import DocRow from "./doc-row.svelte";

  let {
    title,
    pages,
    createHref,
    emptyTitle,
    emptyBody,
    moreHref,
    createLabel,
    moreLabel,
    canWrite = true,
  }: {
    title: string;
    pages: DocPageSummary[];
    /** The editor with the link target prefilled. */
    createHref: string;
    emptyTitle: string;
    emptyBody: string;
    moreHref: string;
    createLabel: string;
    moreLabel: string;
    canWrite?: boolean;
  } = $props();

  const LIMIT = 5;
  const shown = $derived(pages.slice(0, LIMIT));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{title}</Card.Title>
    {#if canWrite}
      <Card.Action>
        <Button href={createHref} size="sm" variant="outline">
          <PlusIcon />{createLabel}
        </Button>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    {#if pages.length === 0}
      <EmptyState
        icon={FileTextIcon}
        title={emptyTitle}
        description={emptyBody}
        class="py-8"
      >
        {#snippet actions()}
          {#if canWrite}
            <Button href={createHref}><PlusIcon />{createLabel}</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each shown as page (page.id)}
          <DocRow {page} />
        {/each}
      </ul>
      {#if pages.length > LIMIT}
        <Button href={moreHref} variant="ghost" size="sm" class="w-fit">
          {moreLabel}
        </Button>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
