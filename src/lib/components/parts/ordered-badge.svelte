<script lang="ts">
  import TruckIcon from "@lucide/svelte/icons/truck";
  import type { Part } from "$lib/api/schemas/parts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { formatDate } from "$lib/format";
  import { m } from "$lib/paraglide/messages";

  let { part }: { part: Pick<Part, "orderedAt" | "orderedQty"> } = $props();
</script>

{#if part.orderedAt}
  <Badge variant="secondary" title={formatDate(part.orderedAt)}>
    <TruckIcon aria-hidden="true" />
    {m.part_on_order({ qty: part.orderedQty })}
  </Badge>
{/if}
