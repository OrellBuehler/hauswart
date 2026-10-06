<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { AssetPart } from "$lib/api/schemas/parts";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import AssetPartDialog from "$lib/components/parts/asset-part-dialog.svelte";
  import PartFormDialog from "$lib/components/parts/part-form-dialog.svelte";
  import PartRow from "$lib/components/parts/part-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    assetId,
    parts,
    currency,
  }: { assetId: string; parts: AssetPart[]; currency: string } = $props();

  let linkOpen = $state(false);
  let createOpen = $state(false);
  let busyId = $state<string | null>(null);

  async function linkCreated(part: { id: string }) {
    try {
      await api.call(endpoints.assetPartsLink, {
        params: { id: assetId },
        body: { partId: part.id },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  }

  async function relink(partId: string) {
    try {
      await api.call(endpoints.assetPartsLink, {
        params: { id: assetId },
        body: { partId },
      });
      toast.success(m.toast_undone());
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  }

  async function unlink(link: AssetPart) {
    if (busyId) return;
    busyId = link.partId;
    try {
      await api.call(endpoints.assetPartsUnlink, {
        params: { id: assetId, partId: link.partId },
      });
      await invalidateAll();
      toast.success(m.part_unlinked_toast({ name: link.part.name }), {
        action: {
          label: m.common_undo(),
          onClick: () => void relink(link.partId),
        },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = null;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.asset_parts_title()}</Card.Title>
    <Card.Action>
      <Button size="sm" variant="outline" onclick={() => (linkOpen = true)}>
        <PlusIcon />{m.part_link_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if parts.length === 0}
      <EmptyState
        icon={PuzzleIcon}
        title={m.asset_parts_empty_title()}
        description={m.asset_parts_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          <Button onclick={() => (linkOpen = true)}>
            <PlusIcon />{m.part_link_add()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each parts as link (link.partId)}
          <PartRow part={link.part}>
            {#snippet trailing()}
              <Button
                variant="ghost"
                size="icon"
                disabled={busyId !== null}
                aria-label={m.part_unlink_aria({ name: link.part.name })}
                onclick={() => unlink(link)}
              >
                <UnlinkIcon />
              </Button>
            {/snippet}
          </PartRow>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<AssetPartDialog
  bind:open={linkOpen}
  {assetId}
  excludeIds={parts.map((link) => link.partId)}
  oncreatenew={() => (createOpen = true)}
  onlinked={() => invalidateAll()}
/>
<PartFormDialog bind:open={createOpen} {currency} onsaved={linkCreated} />
