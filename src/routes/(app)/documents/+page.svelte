<script lang="ts">
  import { resolve } from "$app/paths";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FileStackIcon from "@lucide/svelte/icons/file-stack";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { untrack } from "svelte";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { ExternalDocument } from "$lib/api/schemas/documents";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import ProviderPicker from "$lib/components/connections/provider-picker.svelte";
  import DocumentDetailSheet from "$lib/components/documents/document-detail-sheet.svelte";
  import DocumentThumb from "$lib/components/documents/document-thumb.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import {
    integrationErrorMessage,
    pickerErrorMessage,
  } from "$lib/connections/errors";
  import { documentLinkChanges } from "$lib/documents/changes.svelte";
  import { linkedPlaces } from "$lib/documents/labels";
  import { DocumentSystem } from "$lib/documents/system.svelte";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const PAGE_SIZE = 25;
  type LinkedFilter = "all" | "yes" | "no";

  const system = new DocumentSystem();
  $effect(() => system.start());
  const provider = $derived(system.provider);
  const integration = $derived(system.integration);

  let q = $state("");
  let tag = $state<number[]>([]);
  let correspondent = $state<number[]>([]);
  let linked = $state<LinkedFilter>("all");

  let items = $state.raw<ExternalDocument[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let loadError = $state<string | undefined>();
  let moreError = $state<string | undefined>();
  let sequence = 0;

  let detailOpen = $state(false);
  let detailDocument = $state.raw<ExternalDocument | undefined>();

  const query = $derived(q.trim());
  const filtered = $derived(
    query !== "" ||
      tag.length > 0 ||
      correspondent.length > 0 ||
      linked !== "all",
  );
  const canUnlink = $derived(data.scopes.includes("write"));
  const canUnlinkPages = $derived(data.scopes.includes("docs:write"));

  const linkedOptions = $derived([
    { value: "all" as const, label: m.documents_linked_all() },
    { value: "yes" as const, label: m.documents_linked_yes() },
    { value: "no" as const, label: m.documents_linked_no() },
  ]);

  function filterQuery(cursor?: string) {
    return {
      ...(query ? { q: query } : {}),
      ...(tag[0] !== undefined ? { tag: tag[0] } : {}),
      ...(correspondent[0] !== undefined
        ? { correspondent: correspondent[0] }
        : {}),
      ...(linked !== "all"
        ? { linked: linked === "yes" ? ("true" as const) : ("false" as const) }
        : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    };
  }

  async function search(ticket: number) {
    try {
      const page = await api.call(endpoints.documentsList, {
        query: filterQuery(),
      });
      if (ticket !== sequence) return;
      items = page.items;
      nextCursor = page.nextCursor;
    } catch (err) {
      if (ticket !== sequence) return;
      items = [];
      nextCursor = null;
      loadError = pickerErrorMessage(err, provider ?? "paperless");
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!provider) return;
    const text = query;
    void tag;
    void correspondent;
    void linked;
    void documentLinkChanges.version;
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    moreError = undefined;
    const handle = setTimeout(
      () => void untrack(() => search(ticket)),
      text === "" ? 0 : 300,
    );
    return () => clearTimeout(handle);
  });

  function retry() {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    moreError = undefined;
    void search(ticket);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const ticket = sequence;
    loadingMore = true;
    moreError = undefined;
    try {
      const page = await api.call(endpoints.documentsList, {
        query: filterQuery(nextCursor),
      });
      if (ticket !== sequence) return;
      items = [...items, ...page.items];
      nextCursor = page.nextCursor;
    } catch (err) {
      if (ticket !== sequence) return;
      moreError = pickerErrorMessage(err, provider ?? "paperless");
    } finally {
      loadingMore = false;
    }
  }

  function reset() {
    q = "";
    tag = [];
    correspondent = [];
    linked = "all";
  }

  function openDetail(document: ExternalDocument) {
    detailDocument = document;
    detailOpen = true;
  }

  function details(document: ExternalDocument): string {
    return [
      document.correspondentName,
      document.createdDate ? formatDay(document.createdDate) : null,
      document.pageCount
        ? m.document_pages({ count: document.pageCount })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function warranty(document: ExternalDocument): string | null {
    const until = document.warrantyExtendedUntil ?? document.warrantyUntil;
    return until
      ? m.document_suggestion_warranty({ date: formatDay(until) })
      : null;
  }
</script>

<svelte:head>
  <title>{m.nav_documents()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.nav_documents()}
    description={m.documents_description()}
  />

  {#if provider === undefined}
    <div
      role="status"
      aria-label={m.common_loading()}
      class="flex flex-col gap-3"
    >
      <Skeleton class="h-10 w-full rounded-md" />
      <Skeleton class="h-40 w-full rounded-xl" />
    </div>
  {:else if provider === null}
    <EmptyState
      icon={FileStackIcon}
      title={m.documents_not_connected_title()}
      description={m.documents_not_connected_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/settings/integrations")}>
          {m.documents_to_integrations()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#if integration?.status === "error"}
      <Alert.Root variant="destructive" class="border-destructive/40">
        <TriangleAlertIcon />
        <Alert.Title>{m.integration_error_title()}</Alert.Title>
        <Alert.Description class="text-pretty">
          {m.documents_connection_error()}
          {integrationErrorMessage(integration.lastError, provider)}
          <a
            href={resolve("/settings/integrations")}
            class="mt-1 block underline underline-offset-2"
          >
            {m.documents_to_integrations()}
          </a>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <section class="flex flex-col gap-3" aria-label={m.documents_filters()}>
      <div class="flex flex-col gap-2">
        <div class="relative">
          <SearchIcon
            class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            class="h-10 ps-9"
            placeholder={m.documents_search_placeholder()}
            aria-label={m.documents_search()}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            bind:value={q}
          />
        </div>
        <p class="text-muted-foreground text-xs text-pretty">
          {query
            ? m.document_link_search_live()
            : m.document_link_search_hint()}
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-1.5">
          <Label for="documents-tag">{m.documents_filter_tag()}</Label>
          <ProviderPicker
            id="documents-tag"
            kind={provider}
            source="tags"
            max={1}
            bind:value={tag}
            placeholder={m.documents_filter_tag_any()}
            searchPlaceholder={m.integration_paperless_search_tags()}
          />
        </div>
        <div class="flex min-w-0 flex-col gap-1.5">
          <Label for="documents-correspondent">
            {m.documents_filter_correspondent()}
          </Label>
          <ProviderPicker
            id="documents-correspondent"
            kind={provider}
            source="correspondents"
            max={1}
            bind:value={correspondent}
            placeholder={m.documents_filter_correspondent_any()}
            searchPlaceholder={m.integration_paperless_search_correspondents()}
          />
        </div>
      </div>

      <div
        role="group"
        aria-label={m.documents_filter_linked()}
        class="flex flex-wrap gap-1.5"
      >
        {#each linkedOptions as option (option.value)}
          {@const on = linked === option.value}
          <button
            type="button"
            class={cn(
              "focus-visible:ring-ring/50 inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
              on
                ? "bg-brand text-brand-foreground border-transparent"
                : "bg-background hover:bg-accent dark:bg-input/30",
            )}
            aria-pressed={on}
            onclick={() => (linked = option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <p aria-live="polite">
          {#if !loading && !loadError}
            {m.documents_shown({ count: items.length })}
          {/if}
        </p>
        {#if filtered}
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            onclick={reset}
          >
            {m.documents_filter_reset()}
          </Button>
        {/if}
      </div>
    </section>

    {#if loadError}
      <div
        class="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center"
        role="alert"
      >
        <p class="text-destructive text-sm text-pretty">{loadError}</p>
        <Button variant="outline" onclick={retry}>{m.common_retry()}</Button>
      </div>
    {:else if loading && items.length === 0}
      <ul
        class="bg-card shadow-card divide-y rounded-xl border"
        role="status"
        aria-label={m.common_loading()}
      >
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
      {#if filtered}
        <EmptyState
          icon={SearchXIcon}
          title={m.documents_no_match_title()}
          description={m.documents_no_match_body()}
        >
          {#snippet actions()}
            <Button variant="outline" onclick={reset}>
              {m.documents_filter_reset()}
            </Button>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          icon={FileStackIcon}
          title={m.documents_empty_title()}
          description={m.documents_empty_body()}
        >
          {#snippet actions()}
            <Button variant="outline" href={resolve("/settings/integrations")}>
              {m.documents_to_integrations()}
            </Button>
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      <ul
        class={cn(
          "bg-card shadow-card divide-y rounded-xl border",
          loading && "opacity-60",
        )}
        aria-busy={loading}
        aria-label={m.nav_documents()}
      >
        {#each items as document (document.externalId)}
          <li class="flex items-center gap-1 ps-3 pe-1.5">
            <button
              type="button"
              class="hover:text-foreground focus-visible:ring-ring/50 flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-sm py-2 text-start outline-none focus-visible:ring-[3px]"
              aria-label={m.documents_open_aria({ title: document.title })}
              onclick={() => openDetail(document)}
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
                    class="text-muted-foreground mt-0.5 block text-xs break-words"
                  >
                    {details(document)}
                  </span>
                {/if}
                <span
                  class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                >
                  {#each document.tagNames.slice(0, 3) as name, index (index)}
                    <Badge variant="secondary" class="max-w-32">
                      <span class="truncate">{name}</span>
                    </Badge>
                  {/each}
                  {#if document.tagNames.length > 3}
                    <span class="text-muted-foreground">
                      +{document.tagNames.length - 3}
                    </span>
                  {/if}
                  {#if warranty(document)}
                    <span class="text-muted-foreground tabular-nums">
                      {warranty(document)}
                    </span>
                  {/if}
                  {#if document.linkedTo.length > 0}
                    <span class="text-muted-foreground max-w-full truncate">
                      {m.documents_used_in({
                        places: linkedPlaces(document.linkedTo),
                      })}
                    </span>
                  {:else}
                    <Badge variant="outline">{m.documents_unused()}</Badge>
                  {/if}
                </span>
              </span>
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.document_actions_aria({
                      title: document.title,
                    })}
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="min-w-56">
                <DropdownMenu.Item class="min-h-10">
                  {#snippet child({ props })}
                    <a
                      {...props}
                      href={resolve(document.previewUrl as "/")}
                      target="_blank"
                      rel="noopener"
                    >
                      <ExternalLinkIcon />{m.document_open_preview()}
                    </a>
                  {/snippet}
                </DropdownMenu.Item>
                <DropdownMenu.Item class="min-h-10">
                  {#snippet child({ props })}
                    <a
                      {...props}
                      href={resolve(document.downloadUrl as "/")}
                      download=""
                      data-sveltekit-reload
                    >
                      <DownloadIcon />{m.document_download()}
                    </a>
                  {/snippet}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </li>
        {/each}
      </ul>
      {#if moreError}
        <div class="flex flex-col items-center gap-3 text-center" role="alert">
          <p class="text-destructive text-sm text-pretty">{moreError}</p>
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onclick={loadMore}
          >
            {#if loadingMore}
              <LoaderCircleIcon class="animate-spin" />
            {/if}
            {m.common_retry()}
          </Button>
        </div>
      {:else if nextCursor}
        <div class="text-center">
          <Button
            type="button"
            variant="outline"
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
  {/if}
</div>

{#if provider}
  <DocumentDetailSheet
    bind:open={detailOpen}
    {provider}
    document={detailDocument}
    {canUnlink}
    {canUnlinkPages}
    onchanged={() => retry()}
  />
{/if}
