<script lang="ts">
  import type { Hint } from "$lib/api/schemas/hints";
  import { hintKindIcons, hintKindLabels, hintTones } from "$lib/hints/labels";
  import { cn } from "$lib/utils";

  let {
    hint,
    prominent = false,
  }: { hint: Pick<Hint, "kind" | "title" | "bodyMd">; prominent?: boolean } =
    $props();

  const Icon = $derived(hintKindIcons[hint.kind]);
  const tone = $derived(hintTones[hint.kind]);
</script>

<li
  class={cn(
    "flex items-start gap-3 rounded-xl border p-4",
    prominent ? tone.pinned : tone.card,
  )}
>
  <span
    class={cn(
      "flex shrink-0 items-center justify-center rounded-lg",
      prominent ? "size-10" : "size-8",
      tone.tile,
    )}
    role="img"
    aria-label={hintKindLabels[hint.kind]()}
  >
    <Icon class={prominent ? "size-5" : "size-4"} aria-hidden="true" />
  </span>
  <div class="min-w-0">
    <p
      class={cn(
        "leading-snug font-semibold break-words",
        prominent ? "text-base" : "text-sm",
      )}
    >
      {hint.title}
    </p>
    {#if hint.bodyMd.trim()}
      <p
        class="text-foreground/90 mt-1 text-sm leading-relaxed break-words whitespace-pre-line"
      >
        {hint.bodyMd}
      </p>
    {/if}
  </div>
</li>
