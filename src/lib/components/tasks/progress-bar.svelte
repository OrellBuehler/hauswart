<script lang="ts">
  import { Progress } from "$lib/components/ui/progress/index.js";
  import { formatNumber } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    current,
    target,
    unit,
    class: className,
  }: {
    current: number;
    target: number;
    unit?: string | undefined;
    class?: string;
  } = $props();

  const reached = $derived(current >= target);
  const text = $derived(
    `${formatNumber(current)}/${formatNumber(target)}${unit ? ` ${unit}` : ""}`,
  );
</script>

<div class={cn("flex items-center gap-2", className)}>
  <Progress
    value={Math.min(current, target)}
    max={target}
    aria-label={m.progress_aria({ text })}
    class={cn(
      "bg-brand/20 h-1.5 flex-1",
      reached ? "[&>div]:bg-warning" : "[&>div]:bg-brand",
    )}
  />
  <span class="text-muted-foreground text-xs tabular-nums">{text}</span>
</div>
