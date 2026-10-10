<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
  bind:ref
  data-slot="command-item"
  class={cn(
    "data-selected:bg-accent data-selected:text-accent-foreground relative flex min-h-11 cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-hidden select-none sm:min-h-9 sm:py-1.5 sm:pointer-coarse:min-h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "data-disabled:pointer-events-none data-disabled:opacity-50",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</CommandPrimitive.Item>
