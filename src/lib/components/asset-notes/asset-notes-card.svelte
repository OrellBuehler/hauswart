<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ClipboardCheckIcon from "@lucide/svelte/icons/clipboard-check";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { goto, invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import {
    ASSET_NOTE_MAX_LENGTH,
    type AssetNote,
  } from "$lib/api/schemas/asset-notes";
  import { browserShareEnv, shareOrCopy } from "$lib/asset-notes/share";
  import { formatNotesList, noteExcerpt } from "$lib/asset-notes/text";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { defectHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import NoteItem from "./note-item.svelte";

  let {
    assetId,
    assetName,
    notes,
    canWrite,
  }: {
    assetId: string;
    assetName: string;
    /** The open notes, newest first. */
    notes: AssetNote[];
    canWrite: boolean;
  } = $props();

  let body = $state("");
  let adding = $state(false);
  let addError = $state<string | undefined>();
  let busy = $state<string | null>(null);

  let editing = $state<AssetNote | undefined>();
  let editOpen = $state(false);
  let editBody = $state("");

  let deleting = $state<AssetNote | undefined>();
  let deleteOpen = $state(false);
  let converting = $state<AssetNote | undefined>();
  let convertOpen = $state(false);

  let resolvedOpen = $state(false);
  let resolved = $state.raw<AssetNote[]>([]);
  let resolvedCursor = $state<string | null>(null);
  let resolvedPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let resolvedError = $state<string | undefined>();
  let loadingMore = $state(false);
  let resolvedRun = 0;

  const nearLimit = $derived(body.length >= ASSET_NOTE_MAX_LENGTH * 0.8);

  async function loadResolved(more = false) {
    const run = ++resolvedRun;
    if (more) loadingMore = true;
    else resolvedPhase = "loading";
    resolvedError = undefined;
    try {
      const page = await api.call(endpoints.assetNotesList, {
        params: { id: assetId },
        query: {
          status: "resolved",
          limit: 20,
          ...(more && resolvedCursor ? { cursor: resolvedCursor } : {}),
        },
      });
      if (run !== resolvedRun) return;
      resolved = more ? [...resolved, ...page.items] : page.items;
      resolvedCursor = page.nextCursor;
      resolvedPhase = "ready";
    } catch (err) {
      if (run !== resolvedRun) return;
      resolvedError = apiErrorMessage(err);
      if (!more) resolvedPhase = "error";
      else toast.error(resolvedError);
    } finally {
      if (run === resolvedRun) loadingMore = false;
    }
  }

  function toggleResolved() {
    resolvedOpen = !resolvedOpen;
    if (resolvedOpen && resolvedPhase === "idle") void loadResolved();
  }

  /** A note moved between the lists or went away: the page data refreshes, so does the list of done ones. */
  async function refresh() {
    await invalidateAll();
    if (resolvedPhase !== "idle") await loadResolved();
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const text = body.trim();
    if (adding || !text) return;
    adding = true;
    addError = undefined;
    try {
      await api.call(endpoints.assetNotesCreate, {
        params: { id: assetId },
        body: { body: text },
      });
      body = "";
      toast.success(m.asset_notes_added_toast());
      await invalidateAll();
    } catch (err) {
      addError = apiErrorMessage(err);
    } finally {
      adding = false;
    }
  }

  function addKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  async function setStatus(note: AssetNote, status: "open" | "resolved") {
    if (busy) return;
    busy = note.id;
    try {
      await api.call(endpoints.assetNotesUpdate, {
        params: { id: note.id },
        body: { status },
      });
      if (status === "resolved") {
        toast.success(m.asset_notes_resolved_toast(), {
          action: {
            label: m.common_undo(),
            onClick: () => void setStatus(note, "open"),
          },
        });
      } else {
        toast.success(m.asset_notes_reopened_toast());
      }
      await refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  function askEdit(note: AssetNote) {
    editing = note;
    editBody = note.body;
    editOpen = true;
  }

  async function saveEdit(): Promise<string | void> {
    const note = editing;
    if (!note) return;
    const text = editBody.trim();
    if (!text) return m.field_required();
    if (text === note.body) return;
    try {
      await api.call(endpoints.assetNotesUpdate, {
        params: { id: note.id },
        body: { body: text },
      });
      toast.success(m.asset_notes_saved_toast());
      await refresh();
    } catch (err) {
      return apiErrorMessage(err);
    }
  }

  function askDelete(note: AssetNote) {
    deleting = note;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    await api.call(endpoints.assetNotesDelete, { params: { id: deleting.id } });
    toast.success(m.asset_notes_deleted_toast());
    await refresh();
  }

  function askConvert(note: AssetNote) {
    converting = note;
    convertOpen = true;
  }

  async function convert() {
    if (!converting) return;
    const { defect } = await api.call(endpoints.assetNotesToDefect, {
      params: { id: converting.id },
    });
    toast.success(m.asset_notes_to_defect_toast(), {
      duration: 8000,
      action: {
        label: m.asset_notes_open_defect(),
        onClick: () => void goto(defectHref(defect.id)),
      },
    });
    await refresh();
  }

  let copying = $state(false);

  async function copyList() {
    if (copying || notes.length === 0) return;
    copying = true;
    const heading = m.asset_notes_list_title({ asset: assetName });
    try {
      const outcome = await shareOrCopy(
        {
          title: heading,
          text: formatNotesList(
            heading,
            notes.map((note) => note.body),
          ),
        },
        browserShareEnv(),
      );
      if (outcome === "copied") toast.success(m.asset_notes_copied_toast());
    } catch (err) {
      console.error("copying the notes failed", err);
      toast.error(m.common_copy_failed());
    } finally {
      copying = false;
    }
  }
</script>

<Card.Root id="notes" class="scroll-mt-16">
  <Card.Header>
    <Card.Title class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="min-w-0 wrap-anywhere">{m.asset_notes_title()}</span>
      {#if notes.length > 0}
        <Badge variant="secondary" class="tabular-nums">
          {m.asset_notes_open_badge({ count: notes.length })}
        </Badge>
      {/if}
    </Card.Title>
    <Card.Description>{m.asset_notes_description()}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if canWrite}
      <form class="flex flex-col gap-2" onsubmit={add}>
        <Label for="asset-note-new" class="sr-only">
          {m.asset_notes_add_label()}
        </Label>
        <Textarea
          id="asset-note-new"
          rows={2}
          maxlength={ASSET_NOTE_MAX_LENGTH}
          placeholder={m.asset_notes_add_placeholder()}
          disabled={adding}
          bind:value={body}
          onkeydown={addKeydown}
        />
        <div class="flex items-center justify-between gap-3">
          <p
            class={cn(
              "text-muted-foreground text-xs tabular-nums",
              !nearLimit && "invisible",
            )}
            aria-live="polite"
          >
            {m.asset_notes_chars({
              count: body.length,
              max: ASSET_NOTE_MAX_LENGTH,
            })}
          </p>
          <Button type="submit" size="lg" disabled={adding || !body.trim()}>
            {#if adding}
              <LoaderCircleIcon class="animate-spin" />{m.asset_notes_adding()}
            {:else}
              <PlusIcon />{m.common_add()}
            {/if}
          </Button>
        </div>
        <FormAlert message={addError} />
      </form>
    {/if}

    {#if notes.length === 0}
      <EmptyState
        icon={ClipboardCheckIcon}
        title={m.asset_notes_empty_title()}
        description={m.asset_notes_empty_body()}
        class="py-8"
      />
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each notes as note (note.id)}
          <NoteItem
            {note}
            {canWrite}
            busy={busy === note.id}
            onresolve={() => setStatus(note, "resolved")}
            onreopen={() => setStatus(note, "open")}
            onedit={() => askEdit(note)}
            ontodefect={() => askConvert(note)}
            ondelete={() => askDelete(note)}
          />
        {/each}
      </ul>
      <div>
        <Button
          variant="outline"
          size="lg"
          disabled={copying}
          onclick={copyList}
        >
          {#if copying}
            <LoaderCircleIcon class="animate-spin" />
          {:else}
            <CopyIcon />
          {/if}
          {m.asset_notes_copy()}
        </Button>
      </div>
    {/if}

    <div class="flex flex-col gap-3 border-t pt-3">
      <Button
        variant="ghost"
        class="w-fit"
        aria-expanded={resolvedOpen}
        aria-controls="asset-notes-resolved"
        onclick={toggleResolved}
      >
        <ChevronDownIcon
          class={cn("transition-transform", resolvedOpen && "rotate-180")}
        />
        {resolvedOpen
          ? m.asset_notes_hide_resolved()
          : m.asset_notes_show_resolved()}
      </Button>
      {#if resolvedOpen}
        <div id="asset-notes-resolved" class="flex flex-col gap-3">
          {#if resolvedPhase === "loading" || resolvedPhase === "idle"}
            <div
              class="flex flex-col gap-2"
              role="status"
              aria-label={m.common_loading()}
            >
              <Skeleton class="h-14 w-full rounded-lg" />
              <Skeleton class="h-14 w-full rounded-lg" />
            </div>
          {:else if resolvedPhase === "error"}
            <div class="flex flex-col items-start gap-3">
              <FormAlert message={resolvedError} />
              <Button variant="outline" onclick={() => loadResolved()}>
                {m.common_retry()}
              </Button>
            </div>
          {:else if resolved.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.asset_notes_resolved_empty()}
            </p>
          {:else}
            <ul class="divide-y rounded-lg border">
              {#each resolved as note (note.id)}
                <NoteItem
                  {note}
                  {canWrite}
                  busy={busy === note.id}
                  onresolve={() => setStatus(note, "resolved")}
                  onreopen={() => setStatus(note, "open")}
                  onedit={() => askEdit(note)}
                  ontodefect={() => askConvert(note)}
                  ondelete={() => askDelete(note)}
                />
              {/each}
            </ul>
            {#if resolvedCursor}
              <div class="flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={loadingMore}
                  onclick={() => loadResolved(true)}
                >
                  {#if loadingMore}
                    <LoaderCircleIcon class="animate-spin" />
                  {/if}
                  {m.common_load_more()}
                </Button>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </Card.Content>
</Card.Root>

<FormDialog
  bind:open={editOpen}
  title={m.asset_notes_edit_title()}
  description={m.asset_notes_edit_description()}
  submitLabel={m.common_save()}
  pendingLabel={m.common_saving()}
  onsubmit={saveEdit}
>
  <div class="flex flex-col gap-2">
    <Label for="asset-note-edit" class="sr-only">
      {m.asset_notes_add_label()}
    </Label>
    <Textarea
      id="asset-note-edit"
      rows={4}
      maxlength={ASSET_NOTE_MAX_LENGTH}
      bind:value={editBody}
    />
  </div>
</FormDialog>

<ConfirmDialog
  bind:open={convertOpen}
  title={m.asset_notes_to_defect_title()}
  description={m.asset_notes_to_defect_description({
    text: noteExcerpt(converting?.body ?? ""),
  })}
  confirmLabel={m.asset_notes_to_defect_confirm()}
  pendingLabel={m.asset_notes_to_defect_pending()}
  onconfirm={convert}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.asset_notes_delete_title()}
  description={m.asset_notes_delete_description({
    text: noteExcerpt(deleting?.body ?? ""),
  })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
