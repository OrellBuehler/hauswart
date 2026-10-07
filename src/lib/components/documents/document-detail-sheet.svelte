<script lang="ts">
  import { resolve } from "$app/paths";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FileSymlinkIcon from "@lucide/svelte/icons/file-symlink";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpointUrl } from "$lib/api/client";
  import type { DocumentProviderKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type {
    DocumentLink,
    ExternalDocument,
    ExternalDocumentDetail,
  } from "$lib/api/schemas/documents";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import {
    documentOwnerLabels,
    documentRoleLabels,
  } from "$lib/documents/labels";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import DocumentThumb from "./document-thumb.svelte";

  let {
    open = $bindable(false),
    provider,
    document,
    canUnlink,
    canUnlinkPages,
    onchanged,
  }: {
    open?: boolean;
    provider: DocumentProviderKind;
    /** What the list knows; the sheet asks the document system for the rest. */
    document: ExternalDocument | undefined;
    /** The caller may remove links (the write scope). */
    canUnlink: boolean;
    /** The caller may also remove links to documentation pages (`docs:write`). */
    canUnlinkPages: boolean;
    /** After a link was removed, to refresh the list behind the sheet. */
    onchanged: () => void;
  } = $props();

  let detail = $state.raw<ExternalDocumentDetail | undefined>();
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let sequence = 0;

  let removeTarget = $state<DocumentLink | undefined>();
  let removeOpen = $state(false);

  async function load(externalId: number) {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    try {
      const result = await api.call(endpoints.documentsGet, {
        params: { provider, externalId },
      });
      if (ticket !== sequence) return;
      detail = result;
    } catch (err) {
      if (ticket !== sequence) return;
      loadError = pickerErrorMessage(err, provider);
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!open || !document) return;
    const id = document.externalId;
    untrack(() => {
      detail = undefined;
      void load(id);
    });
  });

  const shown = $derived(detail ?? document);
  const facts = $derived.by(() => {
    if (!shown) return [] as [string, string][];
    const rows: [string, string | null][] = [
      [
        m.documents_field_date(),
        shown.createdDate ? formatDay(shown.createdDate) : null,
      ],
      [m.documents_field_correspondent(), shown.correspondentName],
      [
        m.documents_field_pages(),
        shown.pageCount ? m.document_pages({ count: shown.pageCount }) : null,
      ],
      [
        m.documents_field_notes(),
        shown.noteCount > 0 ? String(shown.noteCount) : null,
      ],
      [
        m.asset_warranty_until(),
        shown.warrantyUntil ? formatDay(shown.warrantyUntil) : null,
      ],
      [
        m.asset_warranty_extended(),
        shown.warrantyExtendedUntil
          ? formatDay(shown.warrantyExtendedUntil)
          : null,
      ],
    ];
    return rows.filter((row): row is [string, string] => row[1] !== null);
  });

  const originalHref = $derived(
    shown
      ? resolve(
          endpointUrl(endpoints.documentsDownload, {
            params: { provider, externalId: shown.externalId },
            query: { original: 1 },
          }) as "/",
        )
      : undefined,
  );

  const mayRemove = (link: DocumentLink) =>
    canUnlink && (link.ownerType !== "page" || canUnlinkPages);

  function askRemove(link: DocumentLink) {
    removeTarget = link;
    removeOpen = true;
  }

  async function remove() {
    if (!removeTarget || !document) return;
    await api.call(endpoints.documentLinksDelete, {
      params: { id: removeTarget.id },
    });
    toast.success(m.document_unlinked_toast());
    onchanged();
    await load(document.externalId);
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full gap-0 p-0 sm:max-w-md">
    <Sheet.Header class="border-b p-4 pe-12">
      <Sheet.Title class="text-pretty break-words">
        {shown?.title ?? ""}
      </Sheet.Title>
      <Sheet.Description class="text-pretty">
        {m.documents_detail_description()}
      </Sheet.Description>
    </Sheet.Header>

    {#if shown}
      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div class="flex items-start gap-4">
          <DocumentThumb url={shown.thumbUrl} class="h-24 w-[4.5rem]" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                href={resolve(shown.previewUrl as "/")}
                target="_blank"
                rel="noopener"
              >
                <FileTextIcon />{m.document_open_preview()}
              </Button>
              <Button
                variant="outline"
                size="sm"
                href={resolve(shown.downloadUrl as "/")}
                download=""
                data-sveltekit-reload
              >
                <DownloadIcon />{m.document_download()}
              </Button>
              {#if originalHref}
                <Button
                  variant="outline"
                  size="sm"
                  href={originalHref}
                  download=""
                  data-sveltekit-reload
                >
                  <FileSymlinkIcon />{m.document_download_original()}
                </Button>
              {/if}
              {#if detail?.webUrl}
                <Button
                  variant="outline"
                  size="sm"
                  href={detail.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLinkIcon />{m.documents_open_in_system()}
                </Button>
              {/if}
            </div>
          </div>
        </div>

        {#if facts.length > 0 || shown.tagNames.length > 0}
          <dl
            class="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm"
          >
            {#each facts as [label, value] (label)}
              <dt class="text-muted-foreground">{label}</dt>
              <dd class="font-medium break-words">{value}</dd>
            {/each}
            {#if shown.tagNames.length > 0}
              <dt class="text-muted-foreground">
                {m.documents_field_tags()}
              </dt>
              <dd class="flex flex-wrap gap-1.5">
                {#each shown.tagNames as name, index (index)}
                  <Badge variant="secondary">{name}</Badge>
                {/each}
              </dd>
            {/if}
          </dl>
        {/if}

        <section class="flex flex-col gap-2 border-t pt-4">
          <h3 class="text-sm font-semibold">{m.documents_links_title()}</h3>
          {#if loadError}
            <div class="flex flex-col items-start gap-3" role="alert">
              <p class="text-destructive text-sm text-pretty">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onclick={() => document && load(document.externalId)}
              >
                {m.common_retry()}
              </Button>
            </div>
          {:else if loading && !detail}
            <div role="status" aria-label={m.common_loading()}>
              <Skeleton class="h-12 w-full rounded-md" />
            </div>
          {:else if detail && detail.links.length === 0}
            <p class="text-muted-foreground text-sm text-pretty">
              {m.documents_links_none()}
            </p>
          {:else if detail}
            <ul class="divide-y rounded-lg border">
              {#each detail.links as link (link.id)}
                <li class="flex items-center gap-1 ps-3 pe-1.5">
                  <div
                    class="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-1 py-2"
                  >
                    {#if link.ownerUrl}
                      <a
                        href={resolve(link.ownerUrl as "/")}
                        class="hover:text-foreground focus-visible:ring-ring/50 min-w-0 rounded-sm text-sm font-medium break-words underline-offset-2 outline-none hover:underline focus-visible:ring-[3px]"
                      >
                        {link.ownerTitle ??
                          documentOwnerLabels[link.ownerType]()}
                      </a>
                    {:else}
                      <span class="text-muted-foreground text-sm">
                        {m.documents_owner_gone()}
                      </span>
                    {/if}
                    <span
                      class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                    >
                      <span>{documentOwnerLabels[link.ownerType]()}</span>
                      <Badge variant="secondary">
                        {documentRoleLabels[link.role]()}
                      </Badge>
                      {#if link.label}
                        <span class="max-w-40 truncate">{link.label}</span>
                      {/if}
                    </span>
                  </div>
                  {#if mayRemove(link)}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.documents_unlink_aria({
                        owner:
                          link.ownerTitle ??
                          documentOwnerLabels[link.ownerType](),
                      })}
                      onclick={() => askRemove(link)}
                    >
                      <UnlinkIcon />
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<ConfirmDialog
  bind:open={removeOpen}
  title={m.document_unlink_title()}
  description={shown
    ? m.document_unlink_description({ title: shown.title })
    : m.document_unlink_description_unavailable()}
  confirmLabel={m.document_unlink()}
  pendingLabel={m.document_unlinking()}
  destructive
  onconfirm={remove}
/>
