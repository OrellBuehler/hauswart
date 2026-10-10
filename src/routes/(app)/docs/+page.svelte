<script lang="ts">
  import { goto } from "$app/navigation";
  import { navigating } from "$app/state";
  import { resolve } from "$app/paths";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import XIcon from "@lucide/svelte/icons/x";
  import { untrack } from "svelte";
  import type { DocSection } from "$lib/api/enums";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import OptionSelect from "$lib/components/assets/option-select.svelte";
  import RoomPicker from "$lib/components/assets/room-picker.svelte";
  import DocRow from "$lib/components/docs/doc-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { docsFilterHref, newDocHref } from "$lib/docs/links";
  import {
    DOC_SECTIONS,
    sectionIcons,
    sectionLabels,
  } from "$lib/docs/sections";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const SEARCH_DELAY_MS = 250;

  let q = $state(untrack(() => data.filter.q ?? ""));
  let committed = untrack(() => data.filter.q ?? "");
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const external = data.filter.q ?? "";
    untrack(() => {
      if (external !== committed) {
        q = external;
        committed = external;
      }
    });
  });

  const filter = $derived(data.filter);
  const filtered = $derived(
    Boolean(filter.q || filter.section || filter.assetId || filter.roomId),
  );
  const loading = $derived(navigating.to?.url.pathname === resolve("/docs"));

  const assetNames = $derived(new Map(data.assets.map((a) => [a.id, a.name])));
  const roomNames = $derived(new Map(data.rooms.map((r) => [r.id, r.name])));
  const sectionOptions = $derived(
    DOC_SECTIONS.map((section) => ({
      value: section,
      label: sectionLabels[section](),
    })),
  );
  const assetOptions = $derived(
    data.assets
      .filter((a) => !a.archivedAt || a.id === filter.assetId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: a.name })),
  );

  const pinned = $derived(data.pages.filter((p) => p.pinned && !p.archivedAt));
  const groups = $derived(
    DOC_SECTIONS.map((section) => ({
      section,
      items: data.pages.filter(
        (p) => p.section === section && !(p.pinned && !p.archivedAt),
      ),
    })).filter((group) => group.items.length > 0),
  );

  function apply(next: {
    q?: string | null;
    section?: DocSection | null;
    assetId?: string | null;
    roomId?: string | null;
    archived?: boolean;
  }) {
    const merged = {
      q: filter.q ?? null,
      section: filter.section ?? null,
      assetId: filter.assetId ?? null,
      roomId: filter.roomId ?? null,
      archived: filter.archived,
      ...next,
    };
    committed = merged.q ?? "";
    void goto(docsFilterHref(merged), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function onsearch() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const trimmed = q.trim();
      if (trimmed !== (filter.q ?? "")) apply({ q: trimmed || null });
    }, SEARCH_DELAY_MS);
  }

  function clearSearch() {
    clearTimeout(timer);
    q = "";
    apply({ q: null });
  }

  function reset() {
    clearTimeout(timer);
    q = "";
    committed = "";
    void goto(resolve("/docs"), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  const createHref = $derived(
    newDocHref({
      section: filter.section,
      assetId: filter.assetId,
      roomId: filter.roomId,
    }),
  );
</script>

<svelte:head>
  <title>{m.nav_docs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_docs()} description={m.docs_description()}>
    {#snippet actions()}
      <Button href={createHref} size="lg">
        <PlusIcon />{m.docs_new()}
      </Button>
    {/snippet}
  </PageHeader>

  <section class="flex flex-col gap-3" aria-label={m.docs_filters()}>
    <div class="relative">
      <SearchIcon
        class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        class="h-10 px-9"
        placeholder={m.docs_search_placeholder()}
        aria-label={m.docs_search()}
        autocomplete="off"
        maxlength={100}
        bind:value={q}
        oninput={onsearch}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            clearTimeout(timer);
            const trimmed = q.trim();
            if (trimmed !== (filter.q ?? "")) apply({ q: trimmed || null });
          }
        }}
      />
      {#if q}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute end-1 top-1/2 size-7 -translate-y-1/2 pointer-coarse:end-0 pointer-coarse:size-10"
          aria-label={m.docs_search_clear()}
          onclick={clearSearch}
        >
          <XIcon />
        </Button>
      {/if}
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <OptionSelect
        options={sectionOptions}
        bind:value={
          () => filter.section ?? null, (value) => apply({ section: value })
        }
        noneLabel={m.docs_filter_all_sections()}
      />
      <OptionSelect
        options={assetOptions}
        bind:value={
          () => filter.assetId ?? null, (value) => apply({ assetId: value })
        }
        noneLabel={m.docs_filter_all_assets()}
      />
      <RoomPicker
        rooms={data.rooms}
        bind:value={
          () => filter.roomId ?? null, (value) => apply({ roomId: value })
        }
        noneLabel={m.inventory_filter_all_rooms()}
        class="data-[size=default]:h-10"
      />
      <div class="flex h-10 items-center gap-2">
        <Switch
          id="docs-archived"
          bind:checked={
            () => filter.archived, (value) => apply({ archived: value })
          }
        />
        <Label for="docs-archived" class="font-normal">
          {m.docs_show_archived()}
        </Label>
      </div>
    </div>
    <div
      class="text-muted-foreground flex items-center justify-between text-xs"
    >
      <p aria-live="polite">
        {m.docs_count({ count: data.pages.length })}
      </p>
      {#if filtered || filter.archived}
        <Button
          variant="link"
          size="sm"
          class="h-auto p-0 text-xs"
          onclick={reset}
        >
          {m.docs_filter_reset()}
        </Button>
      {/if}
    </div>
  </section>

  <div
    class="flex flex-col gap-6 transition-opacity"
    class:opacity-60={loading}
    aria-busy={loading}
  >
    {#if data.pages.length === 0}
      {#if filtered || filter.archived}
        <EmptyState
          icon={SearchXIcon}
          title={m.docs_no_results_title()}
          description={m.docs_no_results_body()}
        >
          {#snippet actions()}
            <Button variant="outline" onclick={reset}
              >{m.docs_filter_reset()}</Button
            >
            <Button href={createHref}><PlusIcon />{m.docs_new()}</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          icon={BookOpenIcon}
          title={m.docs_empty_title()}
          description={m.docs_empty_body()}
        >
          {#snippet actions()}
            <Button href={createHref}><PlusIcon />{m.docs_new()}</Button>
          {/snippet}
        </EmptyState>
      {/if}
    {:else if filter.q}
      <ul class="divide-y rounded-lg border" aria-label={m.docs_results()}>
        {#each data.pages as page (page.id)}
          <DocRow
            {page}
            showSection
            assetName={page.assetId ? assetNames.get(page.assetId) : null}
            roomName={page.roomId ? roomNames.get(page.roomId) : null}
          />
        {/each}
      </ul>
    {:else}
      {#if pinned.length > 0}
        <section
          class="flex flex-col gap-2"
          aria-labelledby="docs-group-pinned"
        >
          <h2
            id="docs-group-pinned"
            class="text-muted-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <PinIcon
              class="size-4 fill-current"
              aria-hidden="true"
            />{m.docs_pinned()}
          </h2>
          <ul class="divide-y rounded-lg border">
            {#each pinned as page (page.id)}
              <DocRow
                {page}
                showSection
                assetName={page.assetId ? assetNames.get(page.assetId) : null}
                roomName={page.roomId ? roomNames.get(page.roomId) : null}
              />
            {/each}
          </ul>
        </section>
      {/if}
      {#each groups as group (group.section)}
        {@const Icon = sectionIcons[group.section]}
        <section
          class="flex flex-col gap-2"
          aria-labelledby={`docs-group-${group.section}`}
        >
          <h2
            id={`docs-group-${group.section}`}
            class="text-muted-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <Icon class="size-4" aria-hidden="true" />{sectionLabels[
              group.section
            ]()}
            <span class="text-xs font-normal tabular-nums"
              >{group.items.length}</span
            >
          </h2>
          <ul class="divide-y rounded-lg border">
            {#each group.items as page (page.id)}
              <DocRow
                {page}
                assetName={page.assetId ? assetNames.get(page.assetId) : null}
                roomName={page.roomId ? roomNames.get(page.roomId) : null}
              />
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
</div>
