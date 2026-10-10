<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="card-header"
  class={cn(
    "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-(--card-px,--spacing(6)) has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:pb-(--card-py,--spacing(6))",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
