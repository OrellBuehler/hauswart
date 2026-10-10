<script lang="ts">
  import FilterIcon from "@lucide/svelte/icons/list-filter";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { DUE_STATUSES, TASK_CATEGORIES } from "$lib/api/enums";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Task } from "$lib/api/schemas/tasks";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import TaskRow from "$lib/components/tasks/task-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import type { DueStatus } from "$lib/tasks/engine/types";
  import {
    activeFilterCount,
    DEFAULT_FILTERS,
    parseTaskFilters,
    TASK_VIEWS,
    taskFilterQuery,
    tasksQuery,
    type TaskFilters,
    type TaskView,
  } from "$lib/tasks/filters";
  import { categoryLabels, statusLabels } from "$lib/tasks/labels";
  import { rowFromTask } from "$lib/tasks/row";
  import { cn } from "$lib/utils";
  import { statusTones } from "$lib/components/tasks/tones";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const people = $derived(
    new Map(data.people.map((p) => [p.id, p.displayName])),
  );
  const activeCount = $derived(activeFilterCount(filters));

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

  async function apply(patch: Partial<TaskFilters>, replace = false) {
    const next = {
      ...parseTaskFilters(new URLSearchParams(location.search)),
      ...patch,
    };
    await goto(resolve(`/tasks${taskFilterQuery(next)}` as "/"), {
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

  function reset() {
    search = "";
    lastApplied = "";
    void apply({ ...DEFAULT_FILTERS, view: filters.view });
  }

  let more = $state.raw<{
    base: Task[];
    items: Task[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);

  const loaded = $derived(more && more.base === data.tasks ? more : null);
  const all = $derived([...data.tasks, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : data.nextCursor);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.tasksList, {
        query: tasksQuery(filters, cursor),
      });
      more = {
        base: data.tasks,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  const assetPlaces = $derived(
    new Map(
      data.assets.map((a) => [
        a.id,
        { roomId: a.roomId, roomName: a.roomName },
      ]),
    ),
  );
  const rows = $derived(
    all.map((task) => rowFromTask(task, people, assetPlaces)),
  );

  const STATUS_ORDER: DueStatus[] = [
    "overdue",
    "due",
    "open",
    "ok",
    "unknown",
    "snoozed",
  ];

  const byDue = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") ||
    a.title.localeCompare(b.title);

  const groups = $derived.by(() => {
    if (filters.view === "status") {
      return STATUS_ORDER.map((status) => ({
        key: status,
        status,
        title: statusLabels[status](),
        rows: rows.filter((r) => r.status === status),
      })).filter((g) => g.rows.length > 0);
    }
    const sorted = [...rows].sort(
      filters.view === "due" ? byDue : (a, b) => a.title.localeCompare(b.title),
    );
    return [{ key: "all", status: null, title: "", rows: sorted }];
  });

  const viewLabels: Record<TaskView, () => string> = {
    status: () => m.tasks_view_status(),
    due: () => m.tasks_view_due(),
    title: () => m.tasks_view_title(),
  };

  const statusOptions = $derived([
    { value: "", label: m.tasks_filter_all() },
    ...DUE_STATUSES.map((s) => ({ value: s, label: statusLabels[s]() })),
  ]);
  const categoryOptions = $derived([
    { value: "", label: m.tasks_filter_all() },
    ...TASK_CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c]() })),
  ]);
  const roomOptions = $derived([
    { value: "", label: m.tasks_filter_all() },
    ...data.rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const assetOptions = $derived([
    { value: "", label: m.tasks_filter_all() },
    ...data.assets.map((a) => ({ value: a.id, label: a.name })),
  ]);
  const viewOptions = $derived(
    TASK_VIEWS.map((v) => ({ value: v, label: viewLabels[v]() })),
  );
</script>

<svelte:head>
  <title>{m.nav_tasks()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.tasks_title()} description={m.tasks_description()}>
    {#snippet actions()}
      <Button href={resolve("/tasks/new")} size="lg" class="max-md:hidden">
        <PlusIcon />
        {m.task_new()}
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
          placeholder={m.tasks_search_placeholder()}
          aria-label={m.tasks_search_label()}
          bind:value={search}
          oninput={onSearchInput}
        />
      </div>
      <div
        class="bg-muted inline-flex rounded-lg p-0.5"
        role="group"
        aria-label={m.tasks_assignee_label()}
      >
        {#each [{ value: "", label: m.tasks_assignee_all() }, { value: "me", label: m.tasks_assignee_me() }] as option (option.value)}
          <button
            type="button"
            class={cn(
              "focus-visible:ring-ring/50 h-10 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
              filters.assignee === option.value
                ? "bg-background shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={filters.assignee === option.value}
            onclick={() => apply({ assignee: option.value as "" | "me" })}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <Button
        variant="outline"
        size="lg"
        aria-expanded={filtersOpen}
        aria-controls="task-filters"
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

    {#if filtersOpen}
      <div
        id="task-filters"
        class="bg-card shadow-card grid grid-cols-2 gap-4 rounded-xl border p-4 lg:grid-cols-3"
      >
        <div class="flex flex-col gap-2">
          <Label for="f-status">{m.tasks_filter_status()}</Label>
          <OptionSelect
            id="f-status"
            value={filters.status}
            options={statusOptions}
            onchange={(v) => apply({ status: v as TaskFilters["status"] })}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="f-category">{m.tasks_filter_category()}</Label>
          <OptionSelect
            id="f-category"
            value={filters.category}
            options={categoryOptions}
            onchange={(v) => apply({ category: v as TaskFilters["category"] })}
          />
        </div>
        <div class="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Label for="f-room">{m.tasks_filter_room()}</Label>
          <OptionSelect
            id="f-room"
            value={filters.roomId}
            options={roomOptions}
            onchange={(v) => apply({ roomId: v })}
          />
        </div>
        <div class="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Label for="f-asset">{m.tasks_filter_asset()}</Label>
          <OptionSelect
            id="f-asset"
            value={filters.assetId}
            options={assetOptions}
            onchange={(v) => apply({ assetId: v })}
          />
        </div>
        <div class="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Label for="f-view">{m.tasks_view_label()}</Label>
          <OptionSelect
            id="f-view"
            value={filters.view}
            options={viewOptions}
            onchange={(v) => apply({ view: v as TaskView })}
          />
        </div>
        <div
          class="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:self-end sm:pb-2"
        >
          <Label for="f-archived">{m.tasks_filter_archived()}</Label>
          <Switch
            id="f-archived"
            checked={filters.archived}
            onCheckedChange={(checked) => apply({ archived: checked })}
          />
        </div>
        {#if activeCount > 0 || filters.q}
          <div class="col-span-2 lg:col-span-3">
            <Button variant="ghost" size="lg" onclick={reset}>
              {m.tasks_filter_reset()}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
    {m.tasks_count({ count: all.length })}
  </p>

  {#if all.length === 0}
    {#if activeCount > 0 || filters.q}
      <EmptyState
        icon={SearchIcon}
        title={m.tasks_empty_filtered_title()}
        description={m.tasks_empty_filtered_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}
            >{m.tasks_filter_reset()}</Button
          >
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon={ListChecksIcon}
        title={m.tasks_empty_title()}
        description={m.tasks_empty_body()}
      >
        {#snippet actions()}
          <Button href={resolve("/tasks/new")}>
            <PlusIcon />
            {m.task_new()}
          </Button>
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    {#each groups as group (group.key)}
      <Card.Root class="gap-0 py-0">
        {#if group.status}
          <h2
            class="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold"
          >
            <span
              class={cn(
                "inline-block size-2.5 rounded-full",
                statusTones[group.status].dot,
              )}
              aria-hidden="true"
            ></span>
            {group.title}
            <span
              class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
              >{group.rows.length}</span
            >
          </h2>
        {/if}
        <ul class="divide-y px-4">
          {#each group.rows as row (row.id)}
            <li>
              <TaskRow task={row} today={data.today} />
            </li>
          {/each}
        </ul>
      </Card.Root>
    {/each}

    {#if cursor}
      <div class="flex justify-center">
        <Button
          variant="outline"
          size="lg"
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

<Button
  href={resolve("/tasks/new")}
  size="icon-lg"
  class="shadow-raised fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 size-14 rounded-full md:hidden"
  aria-label={m.task_new()}
>
  <PlusIcon class="size-6" />
</Button>
