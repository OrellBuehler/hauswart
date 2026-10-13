<script lang="ts">
  import type { CostTagRef } from "$lib/api/schemas/cost-tags";
  import { tagNames } from "$lib/costs/tags";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import TagChip from "./tag-chip.svelte";

  let {
    tags,
    limit = 3,
    class: className,
  }: {
    tags: readonly CostTagRef[];
    /** How many chips show before "+n"; the names of the others are still there for a screen reader and a tooltip. */
    limit?: number;
    class?: string;
  } = $props();

  const shown = $derived(tags.slice(0, limit));
  const rest = $derived(tags.slice(limit));
</script>

{#if tags.length > 0}
  <span class={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
    <span class="sr-only">{m.cost_tags()}: </span>
    {#each shown as tag (tag.id)}
      <TagChip {tag} />
    {/each}
    {#if rest.length > 0}
      <span
        class="bg-muted text-muted-foreground rounded-full border px-2 py-0.5 text-xs leading-tight font-medium tabular-nums"
        title={tagNames(rest)}
        aria-hidden="true">{m.costtag_more({ count: rest.length })}</span
      >
      <span class="sr-only">{tagNames(rest)}</span>
    {/if}
  </span>
{/if}
