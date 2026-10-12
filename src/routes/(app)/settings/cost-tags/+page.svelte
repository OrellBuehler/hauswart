<script lang="ts">
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TagsIcon from "@lucide/svelte/icons/tags";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostTag } from "$lib/api/schemas/cost-tags";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import TagChip from "$lib/components/costs/tag-chip.svelte";
  import TagFormDialog from "$lib/components/costs/tag-form-dialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { tagColorLabels, tagDeleteDescription } from "$lib/costs/tags";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));

  let formOpen = $state(false);
  let editing = $state<CostTag | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<CostTag | undefined>();

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(tag: CostTag) {
    editing = tag;
    formOpen = true;
  }

  function askDelete(tag: CostTag) {
    deleting = tag;
    deleteOpen = true;
  }

  async function remove() {
    const tag = deleting;
    if (!tag) return;
    await api.call(endpoints.costTagsDelete, { params: { id: tag.id } });
    toast.success(m.costtag_deleted_toast({ name: tag.name }));
    await invalidateAfterOverlay();
  }
</script>

<svelte:head>
  <title
    >{m.costtag_settings_title()} · {m.settings_title()} · {m.app_name()}</title
  >
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title class="col-start-1">{m.costtag_settings_title()}</Card.Title>
    <Card.Description class="col-start-1">
      {m.costtag_settings_description()}
      {#if !canWrite}{m.costtag_settings_readonly()}{/if}
    </Card.Description>
    {#if canWrite}
      <Card.Action class="max-sm:hidden">
        <Button onclick={openCreate}><PlusIcon />{m.costtag_new()}</Button>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if canWrite && data.tags.length > 0}
      <Button class="sm:hidden" onclick={openCreate}
        ><PlusIcon />{m.costtag_new()}</Button
      >
    {/if}
    {#if data.tags.length === 0}
      <EmptyState
        icon={TagsIcon}
        title={m.costtag_empty_title()}
        description={m.costtag_empty_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            <Button onclick={openCreate}><PlusIcon />{m.costtag_new()}</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <p class="text-muted-foreground text-sm" aria-live="polite">
        {m.costtag_count({ count: data.tags.length })}
      </p>
      <ul class="divide-y rounded-xl border">
        {#each data.tags as tag (tag.id)}
          <li class="flex min-w-0 items-center gap-3 p-3 sm:px-4">
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <TagChip {tag} class="w-fit text-sm" />
              <p class="text-muted-foreground text-xs">
                <span class="sr-only">{tagColorLabels[tag.color]()}. </span>
                {#if tag.entryCount > 0}
                  <!-- eslint-disable svelte/no-navigation-without-resolve -- the address is resolved here, only the query is appended -->
                  <a
                    href={resolve(
                      `/costs?book=all&tag=${encodeURIComponent(tag.id)}` as "/",
                    )}
                    class="hover:text-foreground focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
                    >{m.costtag_entry_count({ count: tag.entryCount })}</a
                  >
                {:else}
                  {m.costtag_entry_count({ count: 0 })}
                {/if}
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              </p>
            </div>
            {#if canWrite}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost"
                      size="icon-lg"
                      aria-label={m.costtag_actions({ name: tag.name })}
                    >
                      <EllipsisVerticalIcon />
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onclick={() => openEdit(tag)}>
                    <PencilIcon />{m.common_edit()}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    variant="destructive"
                    onclick={() => askDelete(tag)}
                  >
                    <Trash2Icon />{m.common_delete()}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

{#if canWrite}
  <TagFormDialog
    bind:open={formOpen}
    tag={editing}
    tags={data.tags}
    onsaved={invalidateAfterOverlay}
  />
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.costtag_delete_title()}
    description={deleting ? tagDeleteDescription(deleting) : ""}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
