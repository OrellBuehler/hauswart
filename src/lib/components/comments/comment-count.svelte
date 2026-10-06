<script lang="ts">
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let { count, class: className }: { count: number; class?: string } = $props();
</script>

{#if count > 0}
  <span
    class={cn(
      "text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums",
      className,
    )}
    title={m.comments_count({ count })}
  >
    <MessageSquareIcon class="size-3.5" aria-hidden="true" />
    <span aria-hidden="true">{count}</span>
    <span class="sr-only">{m.comments_count({ count })}</span>
  </span>
{/if}
