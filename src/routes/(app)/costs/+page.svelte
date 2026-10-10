<script lang="ts">
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CoinsIcon from "@lucide/svelte/icons/coins";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import FilterIcon from "@lucide/svelte/icons/list-filter";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { COST_CATEGORIES } from "$lib/api/enums";
  import { endpointUrl } from "$lib/api/client";
  import { endpoints } from "$lib/api/registry";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import CostFlags from "$lib/components/costs/cost-flags.svelte";
  import CostRow from "$lib/components/costs/cost-row.svelte";
  import CostsReport from "$lib/components/costs/costs-report.svelte";
  import CostsSummary from "$lib/components/costs/costs-summary.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import {
    MAX_YEAR,
    MIN_YEAR,
    activeFilterCount,
    costFilterQuery,
    parseCostFilters,
    yearOptions,
    type CostFilters,
  } from "$lib/costs/filters";
  import { categoryLabels } from "$lib/costs/labels";
  import { formatDay, monthName } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const canWrite = $derived(data.scopes.includes("costs:write"));
  const activeCount = $derived(activeFilterCount(filters));
  const filtered = $derived(activeCount > 0 || filters.q !== "");
  const csvHref = $derived(
    endpointUrl(endpoints.costsExport, { query: { year: filters.year } }),
  );
  const expensesShown = $derived(
    data.costs.reduce(
      (sum, c) =>
        c.countsAsExpense && c.currency === data.currency
          ? sum + c.amountMinor
          : sum,
      0,
    ),
  );
  const showInbox = $derived(
    data.financeConnected || data.pendingSuggestions > 0,
  );

  let tab = $state("list");
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

  async function apply(patch: Partial<CostFilters>, replace = false) {
    const next = {
      ...parseCostFilters(
        new URLSearchParams(location.search),
        data.defaultYear,
      ),
      ...patch,
    };
    await goto(
      resolve(`/costs${costFilterQuery(next, data.defaultYear)}` as "/"),
      { keepFocus: true, noScroll: true, replaceState: replace },
    );
  }

  function onSearchInput() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = search.trim();
      lastApplied = q;
      void apply({ q }, true);
    }, 300);
  }

  function setYear(year: number) {
    if (year < MIN_YEAR || year > MAX_YEAR) return;
    void apply({ year, month: "" });
  }

  function narrow(patch: Partial<CostFilters>) {
    tab = "list";
    void apply(patch);
  }

  function reset() {
    search = "";
    lastApplied = "";
    void apply({
      q: "",
      category: "",
      assetId: "",
      roomId: "",
      defectId: "",
      paidBy: "",
      month: "",
    });
  }

  const all = $derived({ value: "", label: m.costs_filter_all() });
  const yearChoices = $derived(
    yearOptions(data.defaultYear, filters.year).map((year) => ({
      value: String(year),
      label: String(year),
    })),
  );
  const categoryOptions = $derived([
    all,
    ...COST_CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c]() })),
  ]);
  const payerOptions = $derived([
    all,
    ...data.people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);
  const assetOptions = $derived([
    all,
    ...data.assets.map((a) => ({ value: a.id, label: a.name })),
  ]);
  const roomOptions = $derived([
    all,
    ...data.rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const defectOptions = $derived([
    all,
    ...data.defects.map((d) => ({
      value: d.id,
      label: `#${d.number} ${d.title}`,
    })),
  ]);
  const monthOptions = $derived([
    { value: "", label: m.costs_filter_whole_year() },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1).padStart(2, "0"),
      label: monthName(i + 1),
    })),
  ]);
</script>

<svelte:head>
  <title>{m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.costs_title()} description={m.costs_description()}>
    {#snippet actions()}
      {#if showInbox}
        <Button href={resolve("/costs/inbox")} variant="outline" size="lg">
          <InboxIcon />
          {m.costs_inbox()}
          {#if data.pendingSuggestions > 0}
            <span
              class="bg-brand text-brand-foreground rounded-full px-1.5 text-xs tabular-nums"
              aria-hidden="true"
              >{data.pendingSuggestions}{data.morePendingSuggestions
                ? "+"
                : ""}</span
            >
            <span class="sr-only"
              >{m.costs_inbox_count({ count: data.pendingSuggestions })}</span
            >
          {/if}
        </Button>
      {/if}
      <Button
        href={csvHref}
        download
        data-sveltekit-reload
        variant="outline"
        size="lg"
        title={m.costs_csv_hint({ year: filters.year })}
      >
        <DownloadIcon />
        {m.costs_csv({ year: filters.year })}
      </Button>
      {#if canWrite}
        <Button href={resolve("/costs/new")} size="lg" class="max-md:hidden">
          <PlusIcon />
          {m.cost_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div
    class="flex flex-wrap items-center gap-2"
    role="group"
    aria-label={m.costs_year()}
  >
    <Button
      variant="outline"
      size="icon-lg"
      aria-label={m.costs_year_prev()}
      disabled={filters.year <= MIN_YEAR}
      onclick={() => setYear(filters.year - 1)}
    >
      <ChevronLeftIcon />
    </Button>
    <OptionSelect
      id="costs-year"
      class="w-28 font-medium tabular-nums"
      value={String(filters.year)}
      options={yearChoices}
      onchange={(v) => setYear(Number(v))}
    />
    <Button
      variant="outline"
      size="icon-lg"
      aria-label={m.costs_year_next()}
      disabled={filters.year >= MAX_YEAR}
      onclick={() => setYear(filters.year + 1)}
    >
      <ChevronRightIcon />
    </Button>
  </div>

  <CostsSummary summary={data.summary} />

  <Tabs.Root bind:value={tab} class="gap-4">
    <Tabs.List class="h-10 w-full sm:w-fit">
      <Tabs.Trigger value="list" class="sm:px-4">
        {m.costs_tab_list()}
        <span class="text-muted-foreground text-xs tabular-nums"
          >{data.costs.length}</span
        >
      </Tabs.Trigger>
      <Tabs.Trigger value="report" class="sm:px-4"
        >{m.costs_tab_report()}</Tabs.Trigger
      >
    </Tabs.List>

    <Tabs.Content value="list" class="flex flex-col gap-4">
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
              placeholder={m.costs_search_placeholder()}
              aria-label={m.costs_search_label()}
              autocomplete="off"
              bind:value={search}
              oninput={onSearchInput}
            />
          </div>
          <Button
            variant="outline"
            size="lg"
            aria-expanded={filtersOpen}
            aria-controls="cost-filters"
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
            id="cost-filters"
            class="bg-card shadow-card grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div class="flex flex-col gap-2">
              <Label for="f-category">{m.costs_filter_category()}</Label>
              <OptionSelect
                id="f-category"
                value={filters.category}
                options={categoryOptions}
                onchange={(v) =>
                  apply({ category: v as CostFilters["category"] })}
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="f-month">{m.costs_filter_month()}</Label>
              <OptionSelect
                id="f-month"
                value={filters.month}
                options={monthOptions}
                onchange={(v) => apply({ month: v })}
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="f-paid-by">{m.costs_filter_paid_by()}</Label>
              <OptionSelect
                id="f-paid-by"
                value={filters.paidBy}
                options={payerOptions}
                onchange={(v) => apply({ paidBy: v })}
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="f-asset">{m.costs_filter_asset()}</Label>
              <OptionSelect
                id="f-asset"
                value={filters.assetId}
                options={assetOptions}
                onchange={(v) => apply({ assetId: v })}
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="f-room">{m.costs_filter_room()}</Label>
              <OptionSelect
                id="f-room"
                value={filters.roomId}
                options={roomOptions}
                onchange={(v) => apply({ roomId: v })}
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="f-defect">{m.costs_filter_defect()}</Label>
              <OptionSelect
                id="f-defect"
                value={filters.defectId}
                options={defectOptions}
                onchange={(v) => apply({ defectId: v })}
              />
            </div>
            {#if filtered}
              <div class="sm:col-span-2 lg:col-span-3">
                <Button variant="ghost" size="lg" onclick={reset}>
                  {m.tasks_filter_reset()}
                </Button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="text-muted-foreground -mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm"
        aria-live="polite"
      >
        <p>{m.costs_count({ count: data.costs.length })}</p>
        {#if data.costs.length > 0}
          <p class="tabular-nums">
            {m.costs_expenses_shown({
              amount: formatMoney(expensesShown, data.currency),
            })}
          </p>
        {/if}
      </div>

      {#if data.costs.length === 0}
        {#if filtered}
          <EmptyState
            icon={SearchIcon}
            title={m.costs_empty_filtered_title()}
            description={m.costs_empty_filtered_body()}
          >
            {#snippet actions()}
              <Button variant="outline" onclick={reset}>
                {m.tasks_filter_reset()}
              </Button>
            {/snippet}
          </EmptyState>
        {:else}
          <EmptyState
            icon={CoinsIcon}
            title={m.costs_empty_title({ year: filters.year })}
            description={m.costs_empty_body()}
          >
            {#snippet actions()}
              {#if canWrite}
                <Button href={resolve("/costs/new")}>
                  <PlusIcon />
                  {m.cost_new()}
                </Button>
              {/if}
            {/snippet}
          </EmptyState>
        {/if}
      {:else}
        <Card.Root class="gap-0 py-0 lg:hidden">
          <ul class="divide-y">
            {#each data.costs as cost (cost.id)}
              <CostRow {cost} />
            {/each}
          </ul>
        </Card.Root>

        <Card.Root class="gap-0 py-0 max-lg:hidden">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="w-32">{m.cost_date()}</Table.Head>
                <Table.Head>{m.cost_title()}</Table.Head>
                <Table.Head>{m.cost_category()}</Table.Head>
                <Table.Head>{m.cost_paid_by()}</Table.Head>
                <Table.Head class="text-end">{m.cost_amount()}</Table.Head>
                <Table.Head class="w-12"
                  ><span class="sr-only">{m.comments_title()}</span></Table.Head
                >
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each data.costs as cost (cost.id)}
                {@const place = [cost.assetName, cost.roomName]
                  .filter(Boolean)
                  .join(" · ")}
                <Table.Row class="relative">
                  <Table.Cell class="text-muted-foreground tabular-nums"
                    >{formatDay(cost.date)}</Table.Cell
                  >
                  <Table.Cell class="max-w-sm whitespace-normal">
                    <a
                      href={resolve(`/costs/${cost.id}` as "/")}
                      class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm font-medium break-words outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                      >{cost.title}</a
                    >
                    {#if cost.payee || place}
                      <span
                        class="text-muted-foreground mt-0.5 block text-xs break-words"
                        >{[cost.payee, place].filter(Boolean).join(" · ")}</span
                      >
                    {/if}
                    <CostFlags {cost} class="mt-1.5" />
                  </Table.Cell>
                  <Table.Cell class="whitespace-normal"
                    >{categoryLabels[cost.category]()}</Table.Cell
                  >
                  <Table.Cell
                    class={cn(
                      "whitespace-normal",
                      !cost.paidByName && "text-muted-foreground",
                    )}>{cost.paidByName ?? m.cost_payer_open()}</Table.Cell
                  >
                  <Table.Cell class="text-end font-medium">
                    <CostAmount
                      amountMinor={cost.amountMinor}
                      currency={cost.currency}
                    />
                  </Table.Cell>
                  <Table.Cell class="w-12 text-end">
                    <CommentCount count={cost.commentCount} />
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Root>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="report">
      <CostsReport
        summary={data.summary}
        activeMonth={filters.month}
        onfilter={narrow}
      />
    </Tabs.Content>
  </Tabs.Root>
</div>

{#if canWrite}
  <Button
    href={resolve("/costs/new")}
    size="icon-lg"
    class="shadow-raised fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 size-14 rounded-full md:hidden"
    aria-label={m.cost_new()}
  >
    <PlusIcon class="size-6" />
  </Button>
{/if}
