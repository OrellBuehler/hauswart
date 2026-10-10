<script lang="ts">
  import { cn } from "$lib/utils";

  let {
    plate,
    class: className,
  }: {
    plate: string;
    class?: string;
  } = $props();
</script>

<span
  class={cn(
    "border-foreground/40 bg-card text-foreground inline-flex max-w-full items-center rounded-md border-2 px-2 py-0.5 font-mono text-sm leading-tight font-semibold tracking-[0.12em] wrap-anywhere uppercase shadow-xs",
    className,
  )}
  title={plate}
>
  {plate}
</span>
