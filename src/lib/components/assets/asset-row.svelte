<script lang="ts">
  import { resolve } from "$app/paths";
  import type { Asset } from "$lib/api/schemas/assets";
  import { warrantyStatus } from "$lib/assets/warranty";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import AssetKindIcon from "./asset-kind-icon.svelte";
  import WarrantyBadge from "./warranty-badge.svelte";

  let {
    asset,
    today,
    showRoom = false,
  }: {
    asset: Asset;
    today: string;
    showRoom?: boolean;
  } = $props();

  const subtitle = $derived(
    [
      showRoom ? asset.roomName : null,
      asset.manufacturer,
      asset.model,
      asset.species,
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<li>
  <a
    href={resolve(`/assets/${asset.id}`)}
    class="hover:bg-accent/50 focus-visible:ring-ring/50 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px] sm:grid-cols-[auto_1fr_auto]"
  >
    <AssetKindIcon kind={asset.kind} tile />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">{asset.name}</span>
      {#if subtitle}
        <span class="text-muted-foreground block truncate text-xs">
          {subtitle}
        </span>
      {/if}
    </span>
    {#if asset.archivedAt}
      <Badge
        variant="secondary"
        class="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1"
      >
        {m.asset_archived()}
      </Badge>
    {:else if asset.kind !== "plant"}
      <WarrantyBadge
        info={warrantyStatus(asset, today)}
        class="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1"
      />
    {/if}
  </a>
</li>
