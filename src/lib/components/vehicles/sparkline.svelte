<script lang="ts">
  import { cn } from "$lib/utils";
  import { sparkline, type TrendPoint } from "$lib/vehicles/trend";

  let {
    points,
    label,
    class: className,
  }: {
    points: TrendPoint[];
    label: string;
    class?: string;
  } = $props();

  const WIDTH = 240;
  const HEIGHT = 56;

  const chart = $derived(sparkline(points, WIDTH, HEIGHT, 6));
  const last = $derived(chart?.dots[chart.dots.length - 1]);
</script>

{#if chart && last}
  <svg
    role="img"
    aria-label={label}
    viewBox="0 0 {WIDTH} {HEIGHT}"
    preserveAspectRatio="none"
    class={cn("text-brand h-14 w-full overflow-visible", className)}
  >
    <path d={chart.area} fill="currentColor" fill-opacity="0.12" />
    <path
      d={chart.line}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
    <path
      d="M{last.x} {last.y}h0"
      fill="none"
      stroke="currentColor"
      stroke-width="8"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}
