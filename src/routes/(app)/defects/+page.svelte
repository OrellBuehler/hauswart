<script lang="ts">
  import FileDownIcon from "@lucide/svelte/icons/file-down";
  import FilterIcon from "@lucide/svelte/icons/list-filter";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import WrenchIcon from "@lucide/svelte/icons/wrench";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { DEFECT_SEVERITIES, DEFECT_STATUSES } from "$lib/api/enums";
  import { endpointUrl } from "$lib/api/client";
  import { endpoints } from "$lib/api/registry";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import DefectDeadline from "$lib/components/defects/defect-deadline.svelte";
  import DefectRow from "$lib/components/defects/defect-row.svelte";
  import DefectSeverityBadge from "$lib/components/defects/defect-severity-badge.svelte";
  import DefectStatusBadge from "$lib/components/defects/defect-status-badge.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import {
    activeFilterCount,
    applyDefectFilters,
    DEFECT_SORTS,
    DEFAULT_DEFECT_FILTERS,
    defectFilterQuery,
    exportQuery,
    parseDefectFilters,
    type DefectFilters,
    type DefectSort,
  } from "$lib/defects/filters";
  import { severityLabels, statusLabels } from "$lib/defects/labels";
  import { defectPlace } from "$lib/defects/place";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const shown = $derived(applyDefectFilters(data.defects, filters));
  const activeCount = $derived(activeFilterCount(filters));
  const isDefault = $derived(defectFilterQuery(filters) === "");
  const pdfHref = $derived(
    endpointUrl(endpoints.defectsExport, { query: exportQuery(filters) }),
  );
  const pdfHint = $derived(
    [
      filters.statuses.length === 1
        ? statusLabels[filters.statuses[0]]()
        : m.defects_pdf_all_statuses(),
      data.rooms.find((r) => r.id === filters.roomId)?.name,
    ]
      .filter(Boolean)
      .join(", "),
  );

  let filtersOpen = $state(false);
  let search = $state("");
  let lastApplied = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const q = data.filters.q;
    if (q !== lastApplied) {
      search = q;
      lastApplied = q;
    }
  });

  $effect(() => {
    if (activeCount > 0) filtersOpen = true;
  });

  async function apply(patch: Partial<DefectFilters>, replace = false) {
    const next = {
      ...parseDefectFilters(new URLSearchParams(location.search)),
      ...patch,
    };
    await goto(resolve(`/defects${defectFilterQuery(next)}` as "/"), {
      keepFocus: true,
      noScroll: true,
      replaceState: replace,
    });
  }

  function onSearchInput() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = search.trim();
      lastApplied = q;
      void apply({ q }, true);
    }, 300);
  }

  function toggleStatus(status: (typeof DEFECT_STATUSES)[number]) {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    void apply({ statuses: next.length === 0 ? [...DEFECT_STATUSES] : next });
  }

  function reset() {
    search = "";
    lastApplied = "";
    void apply({ ...DEFAULT_DEFECT_FILTERS });
  }

  const sortLabels: Record<DefectSort, () => string> = {
    deadline: () => m.defects_sort_deadline(),
    number: () => m.defects_sort_number(),
  };
  const sortOptions = DEFECT_SORTS.map((value) => ({
    value,
    label: sortLabels[value](),
  }));
  const severityOptions = $derived([
    { value: "", label: m.defects_filter_all() },
    ...DEFECT_SEVERITIES.map((s) => ({ value: s, label: severityLabels[s]() })),
  ]);
  const roomOptions = $derived([
    { value: "", label: m.defects_filter_all() },
    ...data.rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const assetOptions = $derived([
    { value: "", label: m.defects_filter_all() },
    ...data.assets.map((a) => ({ value: a.id, label: a.name })),
  ]);
</script>

<svelte:head>
  <title>{m.nav_defects()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.defects_title()} description={m.defects_description()}>
    {#snippet actions()}
      <div class="flex flex-col items-start gap-1">
        <Button
          href={pdfHref}
          download
          data-sveltekit-reload
          variant="outline"
          size="lg"
          title={m.defects_pdf_hint({ filter: pdfHint })}
        >
          <FileDownIcon />
          {m.defects_pdf()}
        </Button>
        <p class="text-muted-foreground max-w-60 text-xs text-pretty">
          {m.defects_pdf_scope({ filter: pdfHint })}
        </p>
      </div>
      <Button
        href={resolve("/defects/new")}
        size="lg"
        class="max-md:hidden md:self-start"
      >
        <PlusIcon />
        {m.defect_new()}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-0 flex-1 basis-56">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          class="h-10 ps-9"
          placeholder={m.defects_search_placeholder()}
          aria-label={m.defects_search_label()}
          autocomplete="off"
          bind:value={search}
          oninput={onSearchInput}
        />
      </div>
      <Button
        variant="outline"
        size="lg"
        aria-expanded={filtersOpen}
        aria-controls="defect-filters"
        onclick={() => (filtersOpen = !filtersOpen)}
      >
        <FilterIcon />
        {m.tasks_filters()}
        {#if activeCount > 0}
          <span
            class="bg-brand text-brand-foreground rounded-full px-1.5 text-xs tabular-nums"
            >{activeCount}</span
          >
        {/if}
      </Button>
    </div>

    <div
      role="group"
      aria-label={m.defects_filter_status()}
      class="flex flex-wrap gap-1.5"
    >
      {#each DEFECT_STATUSES as status (status)}
        {@const on = filters.statuses.includes(status)}
        <button
          type="button"
          class={cn(
            "focus-visible:ring-ring/50 h-10 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
            on
              ? "bg-brand text-brand-foreground border-transparent"
              : "bg-background hover:bg-accent dark:bg-input/30",
          )}
          aria-pressed={on}
          onclick={() => toggleStatus(status)}
        >
          {statusLabels[status]()}
        </button>
      {/each}
    </div>

    {#if filtersOpen}
      <div
        id="defect-filters"
        class="bg-card shadow-card grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div class="flex flex-col gap-2">
          <Label for="f-severity">{m.defects_filter_severity()}</Label>
          <OptionSelect
            id="f-severity"
            value={filters.severity}
            options={severityOptions}
            onchange={(v) =>
              apply({ severity: v as DefectFilters["severity"] })}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="f-room">{m.defects_filter_room()}</Label>
          <OptionSelect
            id="f-room"
            value={filters.roomId}
            options={roomOptions}
            onchange={(v) => apply({ roomId: v })}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="f-asset">{m.defects_filter_asset()}</Label>
          <OptionSelect
            id="f-asset"
            value={filters.assetId}
            options={assetOptions}
            onchange={(v) => apply({ assetId: v })}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="f-sort">{m.defects_filter_sort()}</Label>
          <OptionSelect
            id="f-sort"
            value={filters.sort}
            options={sortOptions}
            onchange={(v) => apply({ sort: v as DefectSort })}
          />
        </div>
        {#if !isDefault}
          <div class="sm:col-span-2 lg:col-span-4">
            <Button variant="ghost" size="lg" onclick={reset}>
              {m.tasks_filter_reset()}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
    {m.defects_count({ count: shown.length })}
  </p>

  {#if shown.length === 0}
    {#if data.defects.length === 0 && isDefault}
      <EmptyState
        icon={WrenchIcon}
        title={m.defects_empty_title()}
        description={m.defects_empty_body()}
      >
        {#snippet actions()}
          <Button href={resolve("/defects/new")}>
            <PlusIcon />
            {m.defect_new()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else if data.defects.length > 0 && !filters.q && !filters.severity && !filters.roomId && !filters.assetId && activeCount === 0}
      <EmptyState
        icon={WrenchIcon}
        title={m.defects_none_active_title()}
        description={m.defects_none_active_body()}
      >
        {#snippet actions()}
          <Button
            variant="outline"
            onclick={() => apply({ statuses: [...DEFECT_STATUSES] })}
          >
            {m.defects_show_all()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon={SearchIcon}
        title={m.defects_empty_filtered_title()}
        description={m.defects_empty_filtered_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}>
            {m.tasks_filter_reset()}
          </Button>
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <Card.Root class="gap-0 py-0 lg:hidden">
      <ul class="divide-y">
        {#each shown as defect (defect.id)}
          <DefectRow {defect} today={data.today} />
        {/each}
      </ul>
    </Card.Root>

    <Card.Root class="gap-0 py-0 max-lg:hidden">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="w-16">{m.defect_number()}</Table.Head>
            <Table.Head>{m.defect_title()}</Table.Head>
            <Table.Head>{m.defect_status()}</Table.Head>
            <Table.Head>{m.defect_severity()}</Table.Head>
            <Table.Head>{m.defect_deadline()}</Table.Head>
            <Table.Head class="w-12"
              ><span class="sr-only">{m.comments_title()}</span></Table.Head
            >
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as defect (defect.id)}
            {@const place = defectPlace(defect)}
            <Table.Row class="relative">
              <Table.Cell class="text-muted-foreground tabular-nums"
                >#{defect.number}</Table.Cell
              >
              <Table.Cell class="max-w-sm whitespace-normal">
                <a
                  href={resolve(`/defects/${defect.id}` as "/")}
                  class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm font-medium break-words outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                  >{defect.title}</a
                >
                {#if place}
                  <span
                    class="text-muted-foreground mt-0.5 block text-xs break-words"
                    >{place}</span
                  >
                {/if}
              </Table.Cell>
              <Table.Cell>
                <DefectStatusBadge status={defect.status} />
              </Table.Cell>
              <Table.Cell>
                <DefectSeverityBadge severity={defect.severity} />
              </Table.Cell>
              <Table.Cell>
                <DefectDeadline
                  date={defect.deadlineDate}
                  status={defect.status}
                  today={data.today}
                />
              </Table.Cell>
              <Table.Cell class="w-12 text-end">
                <CommentCount count={defect.commentCount} />
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  {/if}
</div>

<Button
  href={resolve("/defects/new")}
  size="icon-lg"
  class="shadow-raised fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 size-14 rounded-full md:hidden"
  aria-label={m.defect_new()}
>
  <PlusIcon class="size-6" />
</Button>
