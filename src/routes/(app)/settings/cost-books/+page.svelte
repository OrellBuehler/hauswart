<script lang="ts">
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import LibraryIcon from "@lucide/svelte/icons/library";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import StarIcon from "@lucide/svelte/icons/star";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import BookFormDialog from "$lib/components/costs/book-form-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import {
    bookConflictMessage,
    bookDefaultMessage,
    bookIconFor,
  } from "$lib/costs/books";
  import { splitModeLabels } from "$lib/costs/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));
  const open = $derived(data.books.filter((b) => !b.archivedAt));
  const archived = $derived(data.books.filter((b) => b.archivedAt));

  let formOpen = $state(false);
  let editing = $state<CostBook | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<CostBook | undefined>();
  let busy = $state(false);
  /** The open books in their new order while the move is being saved. */
  let reordered = $state.raw<CostBook[] | null>(null);
  const shownOpen = $derived(reordered ?? open);

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(book: CostBook) {
    editing = book;
    formOpen = true;
  }

  function askDelete(book: CostBook) {
    deleting = book;
    deleteOpen = true;
  }

  async function remove() {
    const book = deleting;
    if (!book) return;
    await api.call(endpoints.costBooksDelete, { params: { id: book.id } });
    toast.success(m.costbook_deleted_toast({ name: book.name }));
    await invalidateAfterOverlay();
  }

  function deleteError(err: unknown): string {
    return deleting
      ? (bookConflictMessage(err, deleting) ?? apiErrorMessage(err))
      : apiErrorMessage(err);
  }

  async function setArchived(book: CostBook, archive: boolean) {
    if (busy) return;
    busy = true;
    try {
      await api.call(endpoints.costBooksUpdate, {
        params: { id: book.id },
        body: { archived: archive },
      });
      toast.success(
        archive
          ? m.costbook_archived_toast({ name: book.name })
          : m.costbook_restored_toast({ name: book.name }),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(bookConflictMessage(err, book) ?? apiErrorMessage(err));
    } finally {
      busy = false;
    }
  }

  async function makeDefault(book: CostBook) {
    if (busy) return;
    busy = true;
    try {
      await api.call(endpoints.costBooksUpdate, {
        params: { id: book.id },
        body: { isDefault: true },
      });
      toast.success(m.costbook_default_toast({ name: book.name }));
      await invalidateAll();
    } catch (err) {
      toast.error(bookDefaultMessage(err, book) ?? apiErrorMessage(err));
      // The book may have changed meanwhile (archived elsewhere): show what the server has.
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function move(index: number, delta: -1 | 1) {
    if (busy) return;
    const next = [...open];
    const [book] = next.splice(index, 1);
    if (!book) return;
    next.splice(index + delta, 0, book);
    reordered = next;
    busy = true;
    try {
      await Promise.all(
        next.flatMap((item, position) =>
          item.sortOrder === position
            ? []
            : [
                api.call(endpoints.costBooksUpdate, {
                  params: { id: item.id },
                  body: { sortOrder: position },
                }),
              ],
        ),
      );
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      reordered = null;
      busy = false;
    }
  }
</script>

<svelte:head>
  <title
    >{m.costbook_settings_title()} · {m.settings_title()} · {m.app_name()}</title
  >
</svelte:head>

{#snippet bookRow(book: CostBook, index: number | null)}
  {@const Icon = bookIconFor(book.icon)}
  <li class="relative flex min-w-0 items-center gap-3 p-3 sm:px-4">
    <span
      class="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Icon class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <!-- eslint-disable svelte/no-navigation-without-resolve -- the address is resolved here, only the query is appended -->
        <a
          href={resolve(`/costs?book=${encodeURIComponent(book.id)}` as "/")}
          class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 min-w-0 rounded-sm font-medium wrap-anywhere outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
          >{book.name}</a
        >
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {#if book.isDefault}
          <Badge variant="secondary" title={m.costbook_default_hint()}
            >{m.costbook_default_badge()}</Badge
          >
        {/if}
        {#if book.archivedAt}
          <Badge variant="outline">{m.costbook_archived_badge()}</Badge>
        {/if}
        {#if book.taxRelevant}
          <Badge variant="outline">{m.costbook_tax_badge()}</Badge>
        {/if}
      </p>
      <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
        {splitModeLabels[book.defaultSplitMode]()}
        <span aria-hidden="true">·</span>
        {m.costbook_entry_count({ count: book.entryCount })}
        <span aria-hidden="true">·</span>
        {m.costbook_payment_count({ count: book.settlementCount })}
      </p>
    </div>
    {#if canWrite}
      <div class="relative z-10 shrink-0">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-lg"
                aria-label={m.costbook_actions({ name: book.name })}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item onclick={() => openEdit(book)}>
              <PencilIcon />{m.common_edit()}
            </DropdownMenu.Item>
            {#if !book.archivedAt && !book.isDefault}
              <DropdownMenu.Item onclick={() => makeDefault(book)}>
                <StarIcon />{m.costbook_make_default()}
              </DropdownMenu.Item>
            {/if}
            {#if index !== null}
              <DropdownMenu.Item
                disabled={index === 0}
                onclick={() => move(index, -1)}
              >
                <ArrowUpIcon />{m.costbook_move_up()}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={index === open.length - 1}
                onclick={() => move(index, 1)}
              >
                <ArrowDownIcon />{m.costbook_move_down()}
              </DropdownMenu.Item>
            {/if}
            {#if book.archivedAt}
              <DropdownMenu.Item onclick={() => setArchived(book, false)}>
                <ArchiveRestoreIcon />{m.costbook_restore()}
              </DropdownMenu.Item>
            {:else}
              <DropdownMenu.Item onclick={() => setArchived(book, true)}>
                <ArchiveIcon />{m.costbook_archive()}
              </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              variant="destructive"
              onclick={() => askDelete(book)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/if}
  </li>
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title>{m.costbook_settings_title()}</Card.Title>
    <Card.Description>
      {m.costbook_settings_description()}
      {#if !canWrite}{m.costbook_settings_readonly()}{/if}
    </Card.Description>
    {#if canWrite}
      <Card.Action class="max-sm:hidden">
        <Button onclick={openCreate}><PlusIcon />{m.costbook_new()}</Button>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    {#if canWrite && data.books.length > 0}
      <Button class="sm:hidden" onclick={openCreate}
        ><PlusIcon />{m.costbook_new()}</Button
      >
    {/if}
    {#if data.books.length === 0}
      <EmptyState
        icon={LibraryIcon}
        title={m.costbook_empty_title()}
        description={m.costbook_empty_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            <Button onclick={openCreate}><PlusIcon />{m.costbook_new()}</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <section class="flex flex-col gap-2" aria-labelledby="books-open">
        <h2 id="books-open" class="text-muted-foreground text-sm font-semibold">
          {m.costbook_open_section()}
        </h2>
        <ul class="divide-y rounded-xl border">
          {#each shownOpen as book, index (book.id)}
            {@render bookRow(book, index)}
          {/each}
        </ul>
      </section>
      {#if archived.length > 0}
        <section class="flex flex-col gap-2" aria-labelledby="books-archived">
          <h2
            id="books-archived"
            class="text-muted-foreground text-sm font-semibold"
          >
            {m.costbook_archived_section()}
          </h2>
          <p class="text-muted-foreground -mt-1 text-xs text-pretty">
            {m.costbook_archived_section_hint()}
          </p>
          <ul class="divide-y rounded-xl border">
            {#each archived as book (book.id)}
              {@render bookRow(book, null)}
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

{#if canWrite}
  <BookFormDialog
    bind:open={formOpen}
    book={editing}
    onsaved={invalidateAfterOverlay}
  />
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.costbook_delete_title()}
    description={m.costbook_delete_description({
      name: deleting?.name ?? "",
    })}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
    errorMessage={deleteError}
  />
{/if}
