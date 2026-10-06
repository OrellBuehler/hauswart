<script lang="ts">
  import { create } from "qrcode";
  import { cn } from "$lib/utils";

  let {
    value,
    label,
    class: className,
  }: {
    value: string;
    /** Accessible description of what the code opens. */
    label: string;
    class?: string;
  } = $props();

  const QUIET_ZONE = 2;

  const symbol = $derived.by(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    const size = modules.size;
    let path = "";
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        if (!modules.get(row, col)) {
          col++;
          continue;
        }
        const start = col;
        while (col < size && modules.get(row, col)) col++;
        path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`;
      }
    }
    return { size: size + QUIET_ZONE * 2, path };
  });
</script>

<svg
  viewBox="0 0 {symbol.size} {symbol.size}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
  class={cn("aspect-square h-auto w-full rounded-md bg-white", className)}
>
  <path d={symbol.path} fill="#000" />
</svg>
