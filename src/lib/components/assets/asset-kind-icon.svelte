<script lang="ts">
  import type { AssetKind } from "$lib/api/enums";
  import { kindIcons } from "$lib/assets/kinds";
  import { cn } from "$lib/utils";

  let {
    kind,
    tile = false,
    class: className,
  }: {
    kind: AssetKind;
    /** Draws the icon on a rounded tile. */
    tile?: boolean;
    class?: string;
  } = $props();

  const Icon = $derived(kindIcons[kind]);
</script>

{#if tile}
  <span
    class={cn(
      "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg",
      className,
    )}
    aria-hidden="true"
  >
    <Icon class="size-5" />
  </span>
{:else}
  <Icon class={cn("size-4 shrink-0", className)} aria-hidden="true" />
{/if}
