<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { TaskPart } from "$lib/api/schemas/parts";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import StockBadge from "$lib/components/parts/stock-badge.svelte";
  import TaskPartDialog from "$lib/components/parts/task-part-dialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { partHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";

  let { taskId, parts }: { taskId: string; parts: TaskPart[] } = $props();

  let linkOpen = $state(false);
  let qtyOpen = $state(false);
  let editing = $state<
    { taskId: string; partId: string; label: string; qty: number } | undefined
  >();
  let busyId = $state<string | null>(null);

  function editQty(link: TaskPart) {
    editing = {
      taskId,
      partId: link.partId,
      label: link.part.name,
      qty: link.qty,
    };
    qtyOpen = true;
  }

  async function unlink(link: TaskPart) {
    if (busyId) return;
    busyId = link.partId;
    try {
      await api.call(endpoints.taskPartsUnlink, {
        params: { id: taskId, partId: link.partId },
      });
      toast.success(m.part_unlinked_toast({ name: link.part.name }));
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = null;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-base">{m.task_parts_title()}</Card.Title>
    <Card.Description>{m.task_parts_description()}</Card.Description>
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
        title={m.task_parts_empty_title()}
        description={m.task_parts_empty_body()}
        class="py-8"
      />
    {:else}
      <ul class="divide-y">
        {#each parts as link (link.partId)}
          <li class="flex items-center gap-1 py-2.5 first:pt-0 last:pb-0">
            <div class="min-w-0 flex-1">
              <a
                href={partHref(link.partId)}
                class="text-sm font-medium break-words underline-offset-4 hover:underline"
              >
                {link.part.name}
              </a>
              <div class="mt-1">
                <StockBadge part={link.part} />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="tabular-nums"
              aria-label={m.task_part_edit_aria({ title: link.part.name })}
              onclick={() => editQty(link)}
            >
              {m.task_part_qty_each({ qty: link.qty })}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busyId !== null}
              aria-label={m.part_unlink_aria({ name: link.part.name })}
              onclick={() => unlink(link)}
            >
              <UnlinkIcon />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<TaskPartDialog
  bind:open={linkOpen}
  {taskId}
  excludeIds={parts.map((link) => link.partId)}
  onsaved={() => invalidateAll()}
/>
<TaskPartDialog
  bind:open={qtyOpen}
  existing={editing}
  onsaved={() => invalidateAll()}
/>
