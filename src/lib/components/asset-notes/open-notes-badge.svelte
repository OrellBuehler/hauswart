<script lang="ts">
  import ClipboardListIcon from "@lucide/svelte/icons/clipboard-list";
  import { resolve } from "$app/paths";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    count,
    assetId,
    assetName,
    class: className,
  }: {
    /** The open notes of the asset: nothing is shown for none. */
    count: number;
    assetId: string;
    assetName: string;
    class?: string;
  } = $props();

  const href = $derived(
    `${resolve(`/assets/${encodeURIComponent(assetId)}` as "/")}#notes`,
  );
</script>

{#if count > 0}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- the path is resolved above, only the fragment is appended -->
  <a
    {href}
    class={cn(
      "bg-warning/10 text-warning focus-visible:ring-ring/50 border-warning/40 relative z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums outline-none hover:underline focus-visible:ring-[3px]",
      className,
    )}
    title={m.asset_notes_open_count_title({ asset: assetName })}
  >
    <ClipboardListIcon class="size-3.5" aria-hidden="true" />
    {m.asset_notes_open_count({ count })}
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
