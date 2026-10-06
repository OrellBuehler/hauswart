<script lang="ts">
  import { cn } from "$lib/utils";

  let {
    name,
    id,
    size = "sm",
    class: className,
  }: {
    name: string | null;
    id: string | null;
    size?: "sm" | "md";
    class?: string;
  } = $props();

  const TINTS = [
    "bg-chart-1/20",
    "bg-chart-2/20",
    "bg-chart-3/25",
    "bg-chart-4/20",
    "bg-chart-5/20",
  ];

  function hash(value: string): number {
    let h = 0;
    for (const char of value) h = (h * 31 + char.charCodeAt(0)) >>> 0;
    return h;
  }

  const initials = $derived(
    (name ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?",
  );
</script>

<span
  class={cn(
    "text-foreground inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
    size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
    TINTS[hash(id ?? name ?? "") % TINTS.length],
    className,
  )}
  role="img"
  aria-label={name ?? undefined}
  title={name ?? undefined}>{initials}</span
>
