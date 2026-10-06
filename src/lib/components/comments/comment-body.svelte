<script lang="ts">
  import { linkify } from "$lib/comments/linkify";
  import { cn } from "$lib/utils";

  let { text, class: className }: { text: string; class?: string } = $props();

  const segments = $derived(linkify(text));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<p
  class={cn(
    "text-sm leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap",
    className,
  )}
>
  {#each segments as segment, index (index)}
    {#if segment.href}
      <a
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        class="text-brand focus-visible:ring-ring/50 rounded underline underline-offset-2 outline-none focus-visible:ring-[3px]"
        >{segment.text}</a
      >
    {:else}
      {segment.text}
    {/if}
  {/each}
</p>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
