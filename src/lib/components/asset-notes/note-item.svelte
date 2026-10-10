<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import WrenchIcon from "@lucide/svelte/icons/wrench";
  import type { AssetNote } from "$lib/api/schemas/asset-notes";
  import { noteExcerpt } from "$lib/asset-notes/text";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { formatRelativeInstant } from "$lib/format";
  import { defectHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    note,
    canWrite,
    busy = false,
    onresolve,
    onreopen,
    onedit,
    ontodefect,
    ondelete,
  }: {
    note: AssetNote;
    canWrite: boolean;
    /** A change to this note is on its way. */
    busy?: boolean;
    onresolve: () => void;
    onreopen: () => void;
    onedit: () => void;
    ontodefect: () => void;
    ondelete: () => void;
  } = $props();

  const resolved = $derived(note.status === "resolved");
  const excerpt = $derived(noteExcerpt(note.body));
  const created = $derived(
    [note.createdByName, formatRelativeInstant(note.createdAt)]
      .filter(Boolean)
      .join(" · "),
  );
  const done = $derived(
    note.resolvedAt
      ? note.resolvedByName
        ? m.asset_notes_resolved_by({
            when: formatRelativeInstant(note.resolvedAt),
            name: note.resolvedByName,
          })
        : m.asset_notes_resolved_at({
            when: formatRelativeInstant(note.resolvedAt),
          })
      : null,
  );
</script>

<li class="flex flex-col gap-2.5 px-4 py-3.5" data-note-id={note.id}>
  <div class="flex items-start gap-2">
    <p
      class={cn(
        "min-w-0 flex-1 text-sm leading-relaxed wrap-anywhere whitespace-pre-line",
        resolved && "text-muted-foreground",
      )}
    >
      {note.body}
    </p>
    {#if canWrite}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="-me-2 -mt-1"
              disabled={busy}
              aria-label={m.asset_notes_actions_aria({ text: excerpt })}
            >
              <EllipsisVerticalIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-56">
          <DropdownMenu.Item class="min-h-10" onSelect={onedit}>
            <PencilIcon />{m.common_edit()}
          </DropdownMenu.Item>
          {#if resolved}
            <DropdownMenu.Item class="min-h-10" onSelect={onreopen}>
              <RotateCcwIcon />{m.asset_notes_reopen()}
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item class="min-h-10" onSelect={ontodefect}>
              <WrenchIcon />{m.asset_notes_to_defect()}
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            class="min-h-10"
            onSelect={ondelete}
          >
            <Trash2Icon />{m.common_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <p class="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
    <span>{created}</span>
    {#if resolved && done}
      <span aria-hidden="true">·</span>
      <span>{done}</span>
    {/if}
  </p>

  {#if resolved && (note.defectId || note.serviceLogId)}
    <p class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {#if note.defectId}
        <a
          href={defectHref(note.defectId)}
          class="text-brand inline-flex min-h-6 items-center gap-1 font-medium underline underline-offset-4"
        >
          <WrenchIcon class="size-3.5" aria-hidden="true" />
          {m.asset_notes_via_defect()}
        </a>
      {:else if note.serviceLogId}
        <span>{m.asset_notes_via_service()}</span>
      {/if}
    </p>
  {/if}

  <Attachments
    ownerType="asset_note"
    ownerId={note.id}
    variant="compact"
    editable={canWrite}
    title={m.asset_notes_photos()}
  />

  {#if canWrite && !resolved}
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={m.asset_notes_resolve_aria({ text: excerpt })}
        onclick={onresolve}
      >
        {#if busy}
          <LoaderCircleIcon class="animate-spin" />
        {:else}
          <CheckIcon />
        {/if}
        {m.asset_notes_resolve()}
      </Button>
    </div>
  {/if}
</li>
