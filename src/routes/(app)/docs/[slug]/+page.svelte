<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { resolve } from "$app/paths";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CpuIcon from "@lucide/svelte/icons/cpu";
  import DoorOpenIcon from "@lucide/svelte/icons/door-open";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FileQuestionIcon from "@lucide/svelte/icons/file-question";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import LinkIcon from "@lucide/svelte/icons/link";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import DocProse from "$lib/components/docs/doc-prose.svelte";
  import DocRevisionsSheet from "$lib/components/docs/doc-revisions-sheet.svelte";
  import DocToc from "$lib/components/docs/doc-toc.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { pageErrorMessage } from "$lib/docs/errors";
  import { docEditHref, docHref, newDocHref } from "$lib/docs/links";
  import { sectionIcons, sectionLabels } from "$lib/docs/sections";
  import { formatDateTime } from "$lib/format";
  import { assetHref, roomHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let historyOpen = $state(false);
  let deleteOpen = $state(false);
  let busy = $state(false);
  let article = $state<HTMLElement | null>(null);
  let activeId = $state<string | null>(null);

  const page = $derived(data.page);
  const canWrite = $derived(data.scopes.includes("docs:write"));
  const headings = $derived(page?.headings ?? []);
  const SectionIcon = $derived(page ? sectionIcons[page.section] : null);

  $effect(() => {
    const root = article;
    void page?.renderedHtml;
    if (!root || headings.length < 2) {
      activeId = null;
      return;
    }
    const elements = [...root.querySelectorAll<HTMLElement>("[id]")].filter(
      (el) => /^H[1-6]$/.test(el.tagName),
    );
    if (elements.length === 0) return;
    let visible: string[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = visible.filter((id) => id !== entry.target.id);
          if (entry.isIntersecting) visible.push(entry.target.id);
        }
        const first = elements.find((el) => visible.includes(el.id));
        if (first) activeId = first.id;
      },
      { rootMargin: "-56px 0px -70% 0px" },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  });

  async function patch(
    body: { pinned?: boolean; archived?: boolean },
    success: string,
  ) {
    if (!page || busy) return;
    busy = true;
    try {
      await api.call(endpoints.pagesUpdate, {
        params: { slug: page.slug },
        body: { rev: page.rev, ...body },
      });
      toast.success(success);
      await invalidateAll();
    } catch (err) {
      toast.error(pageErrorMessage(err));
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!page) return;
    const { slug, title } = page;
    await api.call(endpoints.pagesDelete, { params: { slug } });
    toast.success(m.docs_deleted_toast({ title }));
    await gotoFromOverlay(resolve("/docs"), { invalidateAll: true });
  }

  const missingTitle = $derived(
    data.slug
      .replace(/-+/g, " ")
      .trim()
      .replace(/^./, (c) => c.toUpperCase()),
  );
</script>

<svelte:head>
  <title>{page ? page.title : m.docs_missing_title()} · {m.app_name()}</title>
</svelte:head>

{#if !page}
  <div class="mx-auto flex min-h-[60svh] max-w-lg flex-col justify-center">
    <EmptyState
      icon={FileQuestionIcon}
      title={m.docs_missing_title()}
      description={m.docs_missing_body({ slug: data.slug })}
    >
      {#snippet actions()}
        {#if canWrite}
          <Button href={newDocHref({ title: missingTitle })}>
            <FilePlusIcon />{m.docs_missing_create()}
          </Button>
        {/if}
        <Button href={resolve("/docs")} variant="outline">{m.nav_docs()}</Button
        >
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-4">
      <Button
        href={resolve("/docs")}
        variant="ghost"
        size="sm"
        class="text-muted-foreground -ms-2 w-fit max-md:hidden"
      >
        <ArrowLeftIcon />{m.nav_docs()}
      </Button>
      <header class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h1
              class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
            >
              {page.title}
            </h1>
            <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <Badge variant="secondary" class="gap-1.5">
                {#if SectionIcon}<SectionIcon aria-hidden="true" />{/if}
                {sectionLabels[page.section]()}
              </Badge>
              {#if page.pinned}
                <Badge variant="secondary">
                  <PinIcon
                    class="fill-current"
                    aria-hidden="true"
                  />{m.docs_pinned()}
                </Badge>
              {/if}
              {#if page.guestVisible}
                <Badge variant="secondary">
                  <EyeIcon aria-hidden="true" />{m.docs_guest_visible_short()}
                </Badge>
              {/if}
              {#if page.archivedAt}
                <Badge variant="outline">{m.docs_archived()}</Badge>
              {/if}
              {#if data.asset}
                <a
                  href={assetHref(data.asset.id)}
                  class="hover:bg-accent focus-visible:ring-ring/50 inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-[3px]"
                  aria-label={m.docs_linked_asset_aria({
                    name: data.asset.name,
                  })}
                >
                  <CpuIcon class="size-3 shrink-0" aria-hidden="true" />
                  <span class="truncate">{data.asset.name}</span>
                </a>
              {/if}
              {#if data.room}
                <a
                  href={roomHref(data.room.id)}
                  class="hover:bg-accent focus-visible:ring-ring/50 inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-[3px]"
                  aria-label={m.docs_linked_room_aria({ name: data.room.name })}
                >
                  <DoorOpenIcon class="size-3 shrink-0" aria-hidden="true" />
                  <span class="truncate">{data.room.name}</span>
                </a>
              {/if}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            {#if canWrite}
              <Button href={docEditHref(page.slug)} class="max-sm:hidden">
                <PencilIcon />{m.common_edit()}
              </Button>
            {/if}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="outline"
                    size="icon"
                    aria-label={m.docs_actions()}
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="min-w-52">
                {#if canWrite}
                  <DropdownMenu.Item
                    class="min-h-10 sm:hidden"
                    onSelect={() => goto(docEditHref(page.slug))}
                  >
                    <PencilIcon />{m.common_edit()}
                  </DropdownMenu.Item>
                {/if}
                <DropdownMenu.Item
                  class="min-h-10"
                  onSelect={() => (historyOpen = true)}
                >
                  <HistoryIcon />{m.docs_history()}
                </DropdownMenu.Item>
                {#if canWrite}
                  <DropdownMenu.Item
                    class="min-h-10"
                    disabled={busy}
                    onSelect={() =>
                      patch(
                        { pinned: !page.pinned },
                        page.pinned
                          ? m.docs_unpinned_toast()
                          : m.docs_pinned_toast(),
                      )}
                  >
                    {#if page.pinned}
                      <PinOffIcon />{m.docs_unpin()}
                    {:else}
                      <PinIcon />{m.docs_pin()}
                    {/if}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="min-h-10"
                    disabled={busy}
                    onSelect={() =>
                      patch(
                        { archived: !page.archivedAt },
                        page.archivedAt
                          ? m.docs_restored_archive_toast()
                          : m.docs_archived_toast(),
                      )}
                  >
                    {#if page.archivedAt}
                      <ArchiveRestoreIcon />{m.docs_unarchive()}
                    {:else}
                      <ArchiveIcon />{m.docs_archive()}
                    {/if}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    variant="destructive"
                    class="min-h-10"
                    onSelect={() => (deleteOpen = true)}
                  >
                    <Trash2Icon />{m.common_delete()}
                  </DropdownMenu.Item>
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
        <p class="text-muted-foreground text-xs">
          {m.docs_updated_by({
            name: page.updatedByName ?? m.docs_unknown_user(),
            date: formatDateTime(page.updatedAt, { timeZone: data.timeZone }),
            rev: page.rev,
          })}
        </p>
      </header>
    </div>

    <div
      class={[
        "grid items-start gap-6",
        headings.length >= 2 && "lg:grid-cols-[minmax(0,1fr)_16rem]",
      ]}
    >
      <div class="flex min-w-0 flex-col gap-6">
        {#if headings.length >= 2}
          <DocToc {headings} {activeId} class="lg:hidden" />
        {/if}

        <Card.Root>
          <Card.Content>
            <article bind:this={article} aria-label={page.title}>
              {#if page.renderedHtml.trim()}
                <DocProse html={page.renderedHtml} />
              {:else}
                <p class="text-muted-foreground text-sm">
                  {m.docs_body_empty()}
                </p>
              {/if}
            </article>
          </Card.Content>
        </Card.Root>

        {#if page.backlinks.length > 0}
          <section aria-labelledby="doc-backlinks" class="flex flex-col gap-2">
            <h2
              id="doc-backlinks"
              class="text-muted-foreground text-sm font-semibold"
            >
              {m.docs_backlinks()}
            </h2>
            <ul class="flex flex-wrap gap-2">
              {#each page.backlinks as link (link.id)}
                <li>
                  <a
                    href={docHref(link.slug)}
                    class="hover:bg-accent focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]"
                  >
                    <LinkIcon class="size-3.5 shrink-0" aria-hidden="true" />
                    <span class="break-words">{link.title}</span>
                  </a>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <Attachments
          ownerType="page"
          ownerId={page.id}
          editable={canWrite}
          title={m.docs_attachments_title()}
        />
        <LinkedDocuments
          ownerType="page"
          ownerId={page.id}
          editable={canWrite}
        />
        <Comments
          entityType="doc_page"
          entityId={page.id}
          timeZone={data.timeZone}
        />
      </div>

      {#if headings.length >= 2}
        <aside class="max-lg:hidden lg:sticky lg:top-16">
          <DocToc {headings} {activeId} />
        </aside>
      {/if}
    </div>
  </div>

  <DocRevisionsSheet
    bind:open={historyOpen}
    slug={page.slug}
    currentRev={page.rev}
    {canWrite}
    timeZone={data.timeZone}
    onrestored={() => invalidateAll()}
  />

  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.docs_delete_title()}
    description={m.docs_delete_description({ title: page.title })}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
