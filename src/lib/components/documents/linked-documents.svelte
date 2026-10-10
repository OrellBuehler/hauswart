<script lang="ts">
  import { resolve } from "$app/paths";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FileSearchIcon from "@lucide/svelte/icons/file-search";
  import FileSymlinkIcon from "@lucide/svelte/icons/file-symlink";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { DocumentLinkOwnerType } from "$lib/api/enums";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpointUrl } from "$lib/api/client";
  import { endpoints } from "$lib/api/registry";
  import type { DocumentLink } from "$lib/api/schemas/documents";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import {
    documentLinkChanges,
    documentLinksChanged,
  } from "$lib/documents/changes.svelte";
  import { documentRoleLabels } from "$lib/documents/labels";
  import { DocumentSystem } from "$lib/documents/system.svelte";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import DocumentThumb from "./document-thumb.svelte";
  import LinkDocumentDialog from "./link-document-dialog.svelte";

  let {
    ownerType,
    ownerId,
    editable = true,
    variant = "card",
    title,
    description,
    class: className,
  }: {
    ownerType: DocumentLinkOwnerType;
    ownerId: string;
    /** The caller may add and remove links (the write scope; `docs:write` for pages). */
    editable?: boolean;
    /** `card` has a header and an empty state; `compact` is a bare list for use inside another card. */
    variant?: "card" | "compact";
    title?: string;
    description?: string;
    class?: string;
  } = $props();

  const system = new DocumentSystem();
  $effect(() => system.start());

  let links = $state.raw<DocumentLink[]>([]);
  let phase = $state<"loading" | "ready" | "error">("loading");
  let loadError = $state<string | undefined>();
  let loadedKey: string | undefined;
  let generation = 0;

  async function load(type: DocumentLinkOwnerType, id: string) {
    const key = `${type}:${id}`;
    const current = ++generation;
    if (loadedKey !== key) {
      loadedKey = key;
      links = [];
      phase = "loading";
    }
    loadError = undefined;
    try {
      const items = await fetchAll((cursor) =>
        api.call(endpoints.documentLinksList, {
          query: { ownerType: type, ownerId: id, cursor, limit: 200 },
        }),
      );
      if (current !== generation) return;
      links = items;
      phase = "ready";
    } catch (err) {
      if (current !== generation) return;
      loadError = apiErrorMessage(err);
      phase = "error";
    }
  }

  $effect(() => {
    const type = ownerType;
    const id = ownerId;
    void documentLinkChanges.version;
    untrack(() => void load(type, id));
    return () => {
      generation += 1;
    };
  });

  function retry() {
    phase = "loading";
    void load(ownerType, ownerId);
  }

  const provider = $derived(system.provider);
  const canAdd = $derived(editable && Boolean(provider));
  /**
   * A document system is optional: without a connection and without links there is nothing to
   * show or do, so the section stays away instead of announcing an empty list everywhere.
   */
  const visible = $derived(
    phase === "error" ||
      (provider !== undefined && (provider !== null || links.length > 0)),
  );
  const compact = $derived(variant === "compact");

  let addOpen = $state(false);
  let removeTarget = $state<DocumentLink | undefined>();
  let removeOpen = $state(false);

  function askRemove(link: DocumentLink) {
    removeTarget = link;
    removeOpen = true;
  }

  async function remove() {
    if (!removeTarget) return;
    await api.call(endpoints.documentLinksDelete, {
      params: { id: removeTarget.id },
    });
    toast.success(m.document_unlinked_toast());
    documentLinksChanged();
  }

  const originalHref = (link: DocumentLink) =>
    resolve(
      endpointUrl(endpoints.documentsDownload, {
        params: { provider: link.provider, externalId: link.externalId },
        query: { original: 1 },
      }) as "/",
    );

  function details(link: DocumentLink): string[] {
    const doc = link.document;
    if (!doc) return [];
    return [
      doc.correspondentName,
      doc.createdDate ? formatDay(doc.createdDate) : null,
      doc.pageCount ? m.document_pages({ count: doc.pageCount }) : null,
      link.label,
    ].filter((part): part is string => Boolean(part));
  }
</script>

{#snippet menu(link: DocumentLink)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          aria-label={m.document_actions_aria({
            title: link.document?.title ?? m.document_unavailable(),
          })}
        >
          <EllipsisVerticalIcon />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-56">
      {#if link.available && link.previewUrl && link.downloadUrl}
        <DropdownMenu.Item class="min-h-10">
          {#snippet child({ props })}
            <a
              {...props}
              href={resolve(link.previewUrl as "/")}
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
              href={resolve(link.downloadUrl as "/")}
              download=""
              data-sveltekit-reload
            >
              <DownloadIcon />{m.document_download()}
            </a>
          {/snippet}
        </DropdownMenu.Item>
        <DropdownMenu.Item class="min-h-10">
          {#snippet child({ props })}
            <a
              {...props}
              href={originalHref(link)}
              download=""
              data-sveltekit-reload
            >
              <FileSymlinkIcon />{m.document_download_original()}
            </a>
          {/snippet}
        </DropdownMenu.Item>
      {/if}
      {#if editable}
        {#if link.available}<DropdownMenu.Separator />{/if}
        <DropdownMenu.Item
          variant="destructive"
          class="min-h-10"
          onSelect={() => askRemove(link)}
        >
          <UnlinkIcon />{m.document_unlink()}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#snippet row(link: DocumentLink)}
  <li class="flex items-center gap-1 ps-3 pe-1.5">
    {#if link.available && link.document && link.previewUrl}
      <a
        href={resolve(link.previewUrl as "/")}
        target="_blank"
        rel="noopener"
        class="hover:text-foreground focus-visible:ring-ring/50 flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-sm py-2 outline-none focus-visible:ring-[3px]"
      >
        <DocumentThumb url={link.thumbUrl} class="h-12 w-9" />
        <span class="min-w-0">
          <span class="line-clamp-2 block text-sm font-medium break-words">
            {link.document.title}
          </span>
          <span
            class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <Badge variant="secondary">{documentRoleLabels[link.role]()}</Badge>
            {#each details(link) as part, index (index)}
              <span class="max-w-40 truncate">{part}</span>
            {/each}
          </span>
        </span>
        <span class="sr-only">{m.document_open_preview()}</span>
      </a>
    {:else}
      <div class="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2">
        <span
          class="bg-muted text-muted-foreground flex h-12 w-9 shrink-0 items-center justify-center rounded-md border"
          aria-hidden="true"
        >
          <LockKeyholeIcon class="size-4" />
        </span>
        <span class="min-w-0">
          <span class="text-muted-foreground block text-sm font-medium">
            {m.document_unavailable()}
          </span>
          <span
            class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <Badge variant="secondary">{documentRoleLabels[link.role]()}</Badge>
            <span class="text-pretty">{m.document_unavailable_hint()}</span>
          </span>
        </span>
      </div>
    {/if}
    {#if link.available || editable}
      {@render menu(link)}
    {/if}
  </li>
{/snippet}

{#snippet addButton(size: "sm" | "default")}
  <Button
    type="button"
    variant="outline"
    {size}
    onclick={() => (addOpen = true)}
  >
    <PlusIcon />{m.document_link_add()}
  </Button>
{/snippet}

{#snippet headerAddButton()}
  <Button
    type="button"
    variant="outline"
    size="icon-sm"
    class="@md/card-header:hidden"
    aria-label={m.document_link_add()}
    onclick={() => (addOpen = true)}
  >
    <PlusIcon />
  </Button>
  <Button
    type="button"
    variant="outline"
    size="sm"
    class="hidden @md/card-header:inline-flex"
    onclick={() => (addOpen = true)}
  >
    <PlusIcon />{m.document_link_add()}
  </Button>
{/snippet}

{#snippet body()}
  {#if phase === "error"}
    <div class="flex flex-col items-start gap-3">
      <FormAlert message={loadError} />
      <Button variant="outline" onclick={retry}>{m.common_retry()}</Button>
    </div>
  {:else if phase === "loading" && compact}
    <Skeleton
      class="h-8 w-44 rounded-md"
      role="status"
      aria-label={m.common_loading()}
    />
  {:else if phase === "loading"}
    <ul
      class="divide-y rounded-lg border"
      role="status"
      aria-label={m.common_loading()}
    >
      {#each [0, 1] as n (n)}
        <li class="flex items-center gap-3 px-3 py-2">
          <Skeleton class="h-12 w-9 shrink-0 rounded-md" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-1/3" />
          </div>
        </li>
      {/each}
    </ul>
  {:else if links.length === 0}
    {#if compact}
      <div>{@render addButton("sm")}</div>
    {:else}
      <EmptyState
        icon={FileSearchIcon}
        title={m.document_links_empty_title()}
        description={canAdd
          ? m.document_links_empty_body()
          : m.document_links_empty_readonly()}
        class="py-8"
      >
        {#snippet actions()}
          {#if canAdd}
            <Button onclick={() => (addOpen = true)}>
              <PlusIcon />{m.document_link_add()}
            </Button>
          {/if}
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <ul
      class="divide-y rounded-lg border"
      aria-label={title ?? m.document_links_title()}
    >
      {#each links as link (link.id)}
        {@render row(link)}
      {/each}
    </ul>
    {#if compact && canAdd}
      <div class="mt-2">{@render addButton("sm")}</div>
    {/if}
  {/if}
{/snippet}

{#if visible}
  {#if compact}
    <div class={className}>
      {@render body()}
    </div>
  {:else}
    <Card.Root class={className}>
      <Card.Header>
        <Card.Title>{title ?? m.document_links_title()}</Card.Title>
        <Card.Description>
          {description ?? m.document_links_description()}
        </Card.Description>
        {#if canAdd && phase === "ready" && links.length > 0}
          <Card.Action>{@render headerAddButton()}</Card.Action>
        {/if}
      </Card.Header>
      <Card.Content>
        {@render body()}
      </Card.Content>
    </Card.Root>
  {/if}
{/if}

{#if provider}
  <LinkDocumentDialog
    bind:open={addOpen}
    {ownerType}
    {ownerId}
    {provider}
    onlinked={documentLinksChanged}
  />
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title={m.document_unlink_title()}
  description={removeTarget?.document
    ? m.document_unlink_description({ title: removeTarget.document.title })
    : m.document_unlink_description_unavailable()}
  confirmLabel={m.document_unlink()}
  pendingLabel={m.document_unlinking()}
  destructive
  onconfirm={remove}
/>
