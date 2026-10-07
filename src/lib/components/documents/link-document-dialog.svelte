<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    DOCUMENT_LINK_ROLES,
    type DocumentLinkOwnerType,
    type DocumentLinkRole,
    type DocumentProviderKind,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { ExternalDocument } from "$lib/api/schemas/documents";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import {
    documentRoleLabels,
    defaultRoleFor,
    linkedPlaces,
  } from "$lib/documents/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import DocumentThumb from "./document-thumb.svelte";

  let {
    open = $bindable(false),
    ownerType,
    ownerId,
    provider,
    onlinked,
  }: {
    open?: boolean;
    ownerType: DocumentLinkOwnerType;
    ownerId: string;
    provider: DocumentProviderKind;
    /** After the link was made, to reload the list behind the dialog. */
    onlinked: () => void;
  } = $props();

  const PAGE_SIZE = 25;

  let q = $state("");
  let items = $state.raw<ExternalDocument[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  let loadError = $state<string | undefined>();
  let selected = $state.raw<ExternalDocument | null>(null);
  let role = $state<string>("other");
  let label = $state("");
  let selectError = $state<string | undefined>();
  let sequence = 0;

  const query = $derived(q.trim());
  const roleOptions = DOCUMENT_LINK_ROLES.map((value) => ({
    value,
    label: documentRoleLabels[value](),
  }));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      q = "";
      selected = null;
      label = "";
      role = defaultRoleFor(ownerType);
      selectError = undefined;
    });
  });

  async function search(text: string, ticket: number) {
    try {
      const page = await api.call(endpoints.documentsList, {
        query: { ...(text ? { q: text } : {}), limit: PAGE_SIZE },
      });
      if (ticket !== sequence) return;
      items = page.items;
      nextCursor = page.nextCursor;
    } catch (err) {
      if (ticket !== sequence) return;
      items = [];
      nextCursor = null;
      loadError = pickerErrorMessage(err, provider);
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    const text = query;
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    const handle = setTimeout(
      () => void search(text, ticket),
      text === "" ? 0 : 300,
    );
    return () => clearTimeout(handle);
  });

  function retry() {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    void search(query, ticket);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const ticket = sequence;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.documentsList, {
        query: {
          ...(query ? { q: query } : {}),
          cursor: nextCursor,
          limit: PAGE_SIZE,
        },
      });
      if (ticket !== sequence) return;
      items = [...items, ...page.items];
      nextCursor = page.nextCursor;
    } catch (err) {
      if (ticket !== sequence) return;
      loadError = pickerErrorMessage(err, provider);
    } finally {
      loadingMore = false;
    }
  }

  function isLinkedHere(document: ExternalDocument): boolean {
    return document.linkedTo.some(
      (link) => link.ownerType === ownerType && link.ownerId === ownerId,
    );
  }

  function details(document: ExternalDocument): string {
    return [
      document.correspondentName,
      document.createdDate ? formatDay(document.createdDate) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function submit(): Promise<string | void> {
    selectError = undefined;
    if (!selected) {
      selectError = m.document_link_choose();
      return selectError;
    }
    try {
      await api.call(endpoints.documentLinksCreate, {
        body: {
          provider,
          externalId: selected.externalId,
          ownerType,
          ownerId,
          role: role as DocumentLinkRole,
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      });
    } catch (err) {
      return apiErrorMessage(err, {
        conflict: m.document_link_taken(),
        not_found: m.document_link_not_visible(),
      });
    }
    toast.success(m.document_linked_toast());
    onlinked();
  }
</script>

<FormDialog
  bind:open
  title={m.document_link_title()}
  description={m.document_link_description()}
  submitLabel={m.document_link_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
  class="sm:max-w-xl"
>
  <div class="flex flex-col gap-2">
    <Label for="doc-link-search">{m.document_link_search()}</Label>
    <div class="relative">
      <SearchIcon
        class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        id="doc-link-search"
        type="search"
        class="h-10 ps-9"
        placeholder={m.document_link_search_placeholder()}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        bind:value={q}
        onkeydown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
    </div>
    <p class="text-muted-foreground text-xs text-pretty">
      {query ? m.document_link_search_live() : m.document_link_search_hint()}
    </p>
  </div>

  <div class="flex flex-col gap-2">
    <div
      role="radiogroup"
      aria-label={m.document_link_list()}
      aria-busy={loading}
      class="max-h-72 overflow-y-auto rounded-lg border"
    >
      {#if loadError}
        <div
          class="flex flex-col items-center gap-3 px-3 py-6 text-center"
          role="alert"
        >
          <p class="text-destructive text-sm text-pretty">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onclick={retry}>
            {m.common_retry()}
          </Button>
        </div>
      {:else if loading && items.length === 0}
        <ul class="divide-y" role="status" aria-label={m.common_loading()}>
          {#each [0, 1, 2] as n (n)}
            <li class="flex items-center gap-3 px-3 py-3">
              <Skeleton class="h-12 w-9 shrink-0 rounded-md" />
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton class="h-4 w-2/3" />
                <Skeleton class="h-3 w-1/3" />
              </div>
            </li>
          {/each}
        </ul>
      {:else if items.length === 0}
        <p
          class="text-muted-foreground px-3 py-8 text-center text-sm text-pretty"
        >
          {query ? m.document_link_no_match() : m.document_link_none_synced()}
        </p>
      {:else}
        <ul class="divide-y">
          {#each items as document (document.externalId)}
            {@const isSelected = selected?.externalId === document.externalId}
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                class={cn(
                  "hover:bg-accent/50 focus-visible:ring-ring/50 flex min-h-16 w-full items-center gap-3 px-3 py-2 text-start transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                  isSelected && "bg-accent",
                )}
                onclick={() => {
                  selected = document;
                  selectError = undefined;
                }}
              >
                <DocumentThumb url={document.thumbUrl} class="h-12 w-9" />
                <span class="min-w-0 flex-1">
                  <span
                    class="line-clamp-2 block text-sm font-medium break-words"
                  >
                    {document.title}
                  </span>
                  {#if details(document)}
                    <span
                      class="text-muted-foreground block text-xs break-words"
                    >
                      {details(document)}
                    </span>
                  {/if}
                  {#if document.tagNames.length > 0}
                    <span
                      class="text-muted-foreground block text-xs break-words"
                    >
                      {document.tagNames.join(", ")}
                    </span>
                  {/if}
                  {#if isLinkedHere(document)}
                    <Badge variant="secondary" class="mt-1">
                      {m.document_link_already_here()}
                    </Badge>
                  {:else if document.linkedTo.length > 0}
                    <span
                      class="text-muted-foreground mt-0.5 block truncate text-xs"
                    >
                      {m.document_link_used_in({
                        places: linkedPlaces(document.linkedTo),
                      })}
                    </span>
                  {/if}
                </span>
                {#if isSelected}
                  <CheckIcon class="size-4 shrink-0" aria-hidden="true" />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if nextCursor}
          <div class="border-t p-2 text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onclick={loadMore}
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
    {#if selectError}
      <p class="text-destructive text-xs text-pretty" role="alert">
        {selectError}
      </p>
    {/if}
    <p class="text-muted-foreground text-xs text-pretty" aria-live="polite">
      {selected
        ? m.document_link_selected({ title: selected.title })
        : m.document_link_none_selected()}
    </p>
  </div>

  <Field id="doc-link-role" label={m.document_link_role()}>
    {#snippet children({ describedby })}
      <OptionSelect
        id="doc-link-role"
        options={roleOptions}
        bind:value={role}
        {describedby}
      />
    {/snippet}
  </Field>

  <Field
    id="doc-link-label"
    label={m.document_link_label()}
    hint={m.document_link_label_hint()}
    optional
  >
    {#snippet children({ describedby })}
      <Input
        id="doc-link-label"
        class="h-10"
        maxlength={200}
        autocomplete="off"
        bind:value={label}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
</FormDialog>
