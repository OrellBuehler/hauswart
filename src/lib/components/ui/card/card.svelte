<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="card"
  class={cn(
    "bg-card text-card-foreground flex min-w-0 flex-col gap-(--card-gap) rounded-xl border py-(--card-py) shadow-card transition-shadow [--card-gap:--spacing(4)] [--card-px:--spacing(4)] [--card-py:--spacing(4)] sm:[--card-gap:--spacing(6)] sm:[--card-px:--spacing(6)] sm:[--card-py:--spacing(6)]",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
