<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Hint } from "$lib/api/schemas/hints";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import HintCard from "$lib/components/hints/hint-card.svelte";
  import HintFormDialog from "$lib/components/hints/hint-form-dialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let { assetId, hints }: { assetId: string; hints: Hint[] } = $props();

  let formOpen = $state(false);
  let editing = $state<Hint | undefined>();
  let deleting = $state<Hint | undefined>();
  let deleteOpen = $state(false);
  let busyId = $state<string | null>(null);

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(hint: Hint) {
    editing = hint;
    formOpen = true;
  }

  async function patch(
    hint: Hint,
    body: { pinned: boolean } | { guestVisible: boolean },
  ) {
    if (busyId) return;
    busyId = hint.id;
    try {
      await api.call(endpoints.hintsUpdate, {
        params: { id: hint.id },
        body,
      });
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = null;
    }
  }

  /** Swaps a hint with its neighbour; sort orders are renumbered so equal values cannot block a move. */
  async function move(hint: Hint, direction: -1 | 1) {
    if (busyId) return;
    const index = hints.findIndex((h) => h.id === hint.id);
    const target = index + direction;
    if (target < 0 || target >= hints.length) return;
    if (hints[target].pinned !== hint.pinned) return;
    const order = [...hints];
    [order[index], order[target]] = [order[target], order[index]];
    busyId = hint.id;
    try {
      await Promise.all(
        order.flatMap((h, position) =>
          h.sortOrder === position * 10
            ? []
            : [
                api.call(endpoints.hintsUpdate, {
                  params: { id: h.id },
                  body: { sortOrder: position * 10 },
                }),
              ],
        ),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = null;
    }
  }

  function askDelete(hint: Hint) {
    deleting = hint;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    const { id, title } = deleting;
    await api.call(endpoints.hintsDelete, { params: { id } });
    toast.success(m.hint_deleted_toast({ title }));
    await invalidateAll();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.asset_hints_title()}</Card.Title>
    <Card.Action>
      <Button size="sm" variant="outline" onclick={openCreate}>
        <PlusIcon />{m.hint_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if hints.length === 0}
      <EmptyState
        icon={LightbulbIcon}
        title={m.hints_empty_title()}
        description={m.hints_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          <Button onclick={openCreate}><PlusIcon />{m.hint_add()}</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each hints as hint, index (hint.id)}
          <HintCard
            {hint}
            busy={busyId !== null}
            canMoveUp={index > 0 && hints[index - 1].pinned === hint.pinned}
            canMoveDown={index < hints.length - 1 &&
              hints[index + 1].pinned === hint.pinned}
            onedit={() => openEdit(hint)}
            ontogglepin={() => patch(hint, { pinned: !hint.pinned })}
            ontoggleguest={() =>
              patch(hint, { guestVisible: !hint.guestVisible })}
            onmove={(direction) => move(hint, direction)}
            ondelete={() => askDelete(hint)}
          />
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<HintFormDialog
  bind:open={formOpen}
  {assetId}
  hint={editing}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.hint_delete_title()}
  description={m.hint_delete_description({ title: deleting?.title ?? "" })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
