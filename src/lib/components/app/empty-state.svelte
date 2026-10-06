<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    icon: Icon,
    title,
    description,
    actions,
    class: className,
  }: {
    icon: Component;
    title: string;
    description?: string;
    actions?: Snippet;
    class?: string;
  } = $props();
</script>

<div
  class={cn(
    "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
    className,
  )}
>
  <span
    class="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full"
    aria-hidden="true"
  >
    <Icon class="size-6" />
  </span>
  <div class="flex max-w-md flex-col gap-1">
    <h2 class="text-base font-semibold">{title}</h2>
    {#if description}
      <p class="text-muted-foreground text-sm text-pretty">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
