<script lang="ts">
  import { cn } from "$lib/utils";

  let { html, class: className }: { html: string; class?: string } = $props();
</script>

<div
  class={cn(
    "text-foreground leading-relaxed break-words",
    "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold",
    "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
    "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-lg [&_h3]:font-semibold",
    "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
    "[&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:italic",
    "[&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
    "[&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md",
    "[&_code]:bg-muted [&_pre]:bg-muted [&_code]:rounded [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3",
    "[&_.secret]:my-3 [&_.secret]:rounded-md [&_.secret]:border-2 [&_.secret]:border-dashed [&_.secret]:border-red-600 [&_.secret]:p-3",
    "[&_.callout]:my-3 [&_.callout]:rounded-md [&_.callout]:border [&_.callout]:p-3",
    className,
  )}
>
  <!-- The HTML comes from the markdown renderer's sanitizer (tag and attribute allowlist). -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>
