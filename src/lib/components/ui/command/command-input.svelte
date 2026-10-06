<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(""),
    ...restProps
  }: CommandPrimitive.InputProps = $props();
</script>

<div
  data-slot="command-input-wrapper"
  class="flex h-12 items-center gap-2 border-b px-3"
>
  <SearchIcon class="size-4 shrink-0 opacity-50" aria-hidden="true" />
  <CommandPrimitive.Input
    bind:ref
    bind:value
    data-slot="command-input"
    class={cn(
      "placeholder:text-muted-foreground flex h-10 w-full bg-transparent text-base outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    )}
    {...restProps}
  />
</div>
