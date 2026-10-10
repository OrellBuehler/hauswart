<script lang="ts">
  import { api } from "$lib/api/browser";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import type { AssetNote } from "$lib/api/schemas/asset-notes";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    assetId,
    selected = $bindable([]),
    idPrefix = "notes",
    class: className,
  }: {
    assetId: string;
    /** The ids of the notes the person ticked. */
    selected?: string[];
    idPrefix?: string;
    class?: string;
  } = $props();

  let notes = $state.raw<AssetNote[]>([]);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let error = $state<string | undefined>();
  let run = 0;

  async function load() {
    const current = ++run;
    phase = "loading";
    error = undefined;
    try {
      const open = await fetchAll((cursor) =>
        api.call(endpoints.assetNotesList, {
          params: { id: assetId },
          query: { status: "open", limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      );
      if (current !== run) return;
      notes = open;
      // What was ticked before and has been resolved elsewhere since is no longer a choice.
      selected = selected.filter((id) => open.some((note) => note.id === id));
      phase = "ready";
    } catch (err) {
      if (current !== run) return;
      error = apiErrorMessage(err);
      phase = "error";
    }
  }

  $effect(() => {
    void assetId;
    void load();
    return () => {
      run += 1;
    };
  });

  const allSelected = $derived(
    notes.length > 0 && notes.every((note) => selected.includes(note.id)),
  );

  function toggle(id: string, on: boolean) {
    selected = on
      ? [...selected.filter((value) => value !== id), id]
      : selected.filter((value) => value !== id);
  }

  function toggleAll() {
    selected = allSelected ? [] : notes.map((note) => note.id);
  }
</script>

{#if phase === "loading"}
  <div
    class={cn("flex flex-col gap-2", className)}
    role="status"
    aria-label={m.asset_notes_picker_loading()}
  >
    <Skeleton class="h-5 w-40" />
    <Skeleton class="h-11 w-full rounded-lg" />
  </div>
{:else if phase === "error"}
  <div class={cn("flex flex-col items-start gap-3", className)}>
    <FormAlert message={error} />
    <Button type="button" variant="outline" onclick={() => load()}>
      {m.common_retry()}
    </Button>
  </div>
{:else if notes.length > 0}
  <fieldset class={cn("flex min-w-0 flex-col gap-2", className)}>
    <legend class="sr-only">{m.asset_notes_picker_title()}</legend>
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div class="min-w-0">
        <p class="text-sm font-medium">{m.asset_notes_picker_title()}</p>
        <p class="text-muted-foreground text-xs text-pretty">
          {m.asset_notes_picker_hint()}
        </p>
      </div>
      {#if notes.length > 1}
        <Button
          type="button"
          variant="link"
          size="sm"
          class="h-auto p-0 text-xs"
          onclick={toggleAll}
        >
          {allSelected
            ? m.asset_notes_picker_none()
            : m.asset_notes_picker_all()}
        </Button>
      {/if}
    </div>
    <ul class="divide-y rounded-lg border">
      {#each notes as note (note.id)}
        <li>
          <Label
            for={`${idPrefix}-${note.id}`}
            class="hover:bg-accent/50 min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 leading-snug font-normal"
          >
            <Checkbox
              id={`${idPrefix}-${note.id}`}
              class="mt-0.5"
              checked={selected.includes(note.id)}
              onCheckedChange={(on) => toggle(note.id, on)}
            />
            <span class="min-w-0 text-sm wrap-anywhere whitespace-pre-line"
              >{note.body}</span
            >
          </Label>
        </li>
      {/each}
    </ul>
  </fieldset>
{/if}
