<script lang="ts">
  import type { Component } from "svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDateShort } from "$lib/format";

  let {
    title,
    icon: Icon,
    items,
    today,
  }: {
    title: string;
    icon: Component;
    items: { id: string; title: string; date: string | null }[];
    today: string;
  } = $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <Icon class="text-muted-foreground size-4" aria-hidden="true" />
      {title}
    </Card.Title>
  </Card.Header>
  <Card.Content>
    <ul class="divide-y">
      {#each items as item (item.id)}
        <li class="flex items-baseline justify-between gap-3 py-2 text-sm">
          <span class="min-w-0 break-words">{item.title}</span>
          {#if item.date}
            <span class="text-muted-foreground shrink-0 text-xs tabular-nums"
              >{formatDateShort(item.date, { today })}</span
            >
          {/if}
        </li>
      {/each}
    </ul>
  </Card.Content>
</Card.Root>
