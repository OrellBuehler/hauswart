<script lang="ts">
  import type { CostTagRef } from "$lib/api/schemas/cost-tags";
  import { TAG_COLOR_STYLES } from "$lib/costs/tags";
  import { cn } from "$lib/utils";

  let {
    tag,
    class: className,
  }: {
    tag: Pick<CostTagRef, "name" | "color">;
    class?: string;
  } = $props();
</script>

<span
  class={cn(
    "inline-flex max-w-full min-w-0 items-center rounded-full border px-2 py-0.5 text-xs leading-tight font-medium",
    TAG_COLOR_STYLES[tag.color].chip,
    className,
  )}
>
  <span class="truncate">{tag.name}</span>
</span>
