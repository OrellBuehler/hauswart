<script lang="ts">
  import type { AssetKind } from "#lib/api/enums.ts";
  import { cn } from "#lib/utils.ts";
  import AssetKindIcon from "./asset-kind-icon.svelte";

  let {
    photoUrl,
    kind,
    class: className,
  }: {
    /** The asset's `photoUrl` (thumbnail); without one the kind's icon tile is shown. */
    photoUrl: string | null | undefined;
    kind: AssetKind;
    /** Size and shape; the photo and the icon tile share them. */
    class?: string;
  } = $props();

  let failed = $state(false);

  $effect(() => {
    void photoUrl;
    failed = false;
  });
</script>

{#if photoUrl && !failed}
  <img
    src={photoUrl}
    alt=""
    loading="lazy"
    decoding="async"
    class={cn("bg-muted size-10 shrink-0 rounded-lg object-cover", className)}
    onerror={() => (failed = true)}
  />
{:else}
  <AssetKindIcon {kind} tile class={className} />
{/if}
