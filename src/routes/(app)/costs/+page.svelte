<script lang="ts">
  import ArrowRightLeftIcon from "@lucide/svelte/icons/arrow-right-left";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CoinsIcon from "@lucide/svelte/icons/coins";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import FilterIcon from "@lucide/svelte/icons/list-filter";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ReceiptTextIcon from "@lucide/svelte/icons/receipt-text";
  import SearchIcon from "@lucide/svelte/icons/search";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { COST_CATEGORIES } from "$lib/api/enums";
  import { endpointUrl } from "$lib/api/client";
  import { endpoints } from "$lib/api/registry";
  import { MOVE_COSTS_MAX_IDS } from "$lib/api/schemas/costs";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Fab from "$lib/components/app/fab.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import BookFormDialog from "$lib/components/costs/book-form-dialog.svelte";
  import BookSwitcher from "$lib/components/costs/book-switcher.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import CostFlags from "$lib/components/costs/cost-flags.svelte";
  import CostRow from "$lib/components/costs/cost-row.svelte";
  import CostsReport from "$lib/components/costs/costs-report.svelte";
  import CostsSummary from "$lib/components/costs/costs-summary.svelte";
  import MoveCostsDialog from "$lib/components/costs/move-costs-dialog.svelte";
  import TagChips from "$lib/components/costs/tag-chips.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { rememberBook } from "$lib/costs/book-memory";
  import { bookParam, openBooks } from "$lib/costs/books";
  import {
    MAX_YEAR,
    MIN_YEAR,
    activeFilterCount,
    costFilterQuery,
    costsExportQuery,
    isFiltered,
    parseCostFilters,
    reviewFilters,
    yearOptions,
    type CostFilters,
  } from "$lib/costs/filters";
  import { categoryLabels } from "$lib/costs/labels";
  import { moveSummary, pickAll, type MoveTarget } from "$lib/costs/move";
  import { formatDay, monthName } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import {
    gotoFromOverlay,
    invalidateAfterOverlay,
  } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const canWrite = $derived(data.scopes.includes("costs:write"));
  const activeCount = $derived(activeFilterCount(filters));
  const filtered = $derived(isFiltered(filters));
  /** The entries the summary counts as waiting for a review; not offered where that list is on screen already. */
  const reviewHref = $derived(
    filters.reviewNeeded
      ? undefined
      : resolve(
          `/costs${costFilterQuery(reviewFilters(filters), data.defaultYear)}` as "/",
        ),
  );
  const reviewCount = $derived(
    filters.reviewNeeded ? data.costs.length : data.summary.reviewNeededCount,
  );
  const showReviewFilter = $derived(filters.reviewNeeded || reviewCount > 0);
  const csvHref = $derived(
    endpointUrl(endpoints.costsExport, { query: costsExportQuery(filters) }),
  );
  const book = $derived(data.books.find((b) => b.id === filters.bookId));
  const tag = $derived(data.tags.find((t) => t.id === filters.tagId));
  const csvHint = $derived(
    tag
      ? book
        ? m.costs_csv_hint_book_tag({
            year: filters.year,
            name: book.name,
            tag: tag.name,
          })
        : m.costs_csv_hint_tag({ year: filters.year, tag: tag.name })
      : book
        ? m.costs_csv_hint_book({ year: filters.year, name: book.name })
        : m.costs_csv_hint({ year: filters.year }),
  );
  const newHref = $derived(
    resolve(
      `/costs/new${filters.bookId ? `?book=${encodeURIComponent(filters.bookId)}` : ""}` as "/",
    ),
  );
  const quickHref = $derived(
    resolve(
      `/costs/quick${filters.bookId ? `?book=${encodeURIComponent(filters.bookId)}` : ""}` as "/",
    ),
  );
  const balancesHref = $derived(
    resolve(
      `/costs/balances?book=${encodeURIComponent(bookParam(filters.bookId))}` as "/",
    ),
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
  /** The summary covers one device when the device filter is set. */
  const summaryAsset = $derived(
    filters.assetId
      ? {
          name: data.assets.find((a) => a.id === filters.assetId)?.name ?? null,
        }
      : undefined,
  );
  const showInbox = $derived(
    data.financeConnected || data.pendingSuggestions > 0,
  );

  /** Moving entries to another book makes sense with a second book that takes entries. */
  const canMove = $derived(canWrite && openBooks(data.books).length > 1);
  const assetName = $derived(
    filters.assetId
      ? data.assets.find((a) => a.id === filters.assetId)?.name
      : undefined,
  );

  let selecting = $state(false);
  const selected = new SvelteSet<string>();
  let moveOpen = $state(false);
  let moveTarget = $state.raw<MoveTarget | undefined>();
  const selectedEntries = $derived(
    data.costs.filter((cost) => selected.has(cost.id)),
  );
  const allSelected = $derived(
    data.costs.length > 0 &&
      data.costs
        .slice(0, MOVE_COSTS_MAX_IDS)
        .every((cost) => selected.has(cost.id)),
  );

  let tab = $state("list");
  let bookFormOpen = $state(false);
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

  $effect(() => {
    if (data.bookExplicit) rememberBook(data.user.id, data.filters.bookId);
  });

  $effect(() => {
    // What is no longer in the list (another year, another filter) is no longer picked.
    const shown = new Set(data.costs.map((cost) => cost.id));
    untrack(() => {
      for (const id of [...selected]) if (!shown.has(id)) selected.delete(id);
    });
  });

  function stopSelecting() {
    selecting = false;
    selected.clear();
  }

  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  function toggleAll() {
    if (allSelected) {
      selected.clear();
      return;
    }
    for (const id of pickAll(data.costs).ids) selected.add(id);
  }

  function moveSelected() {
    moveTarget = { ids: selectedEntries.map((cost) => cost.id) };
    moveOpen = true;
  }

  function moveAssetEntries() {
    if (!filters.assetId) return;
    moveTarget = { assetId: filters.assetId };
    moveOpen = true;
  }

  async function moved(
    result: Parameters<typeof moveSummary>[0],
    bookName: string,
  ) {
    toast.success(moveSummary(result, bookName));
    stopSelecting();
    await invalidateAfterOverlay();
  }

  function bookHref(bookId: string): string {
    return resolve(
      `/costs${costFilterQuery({ ...filters, bookId }, data.defaultYear)}` as "/",
    );
  }

  async function bookCreated(created: { id: string }) {
    await gotoFromOverlay(
      resolve(
        `/costs${costFilterQuery({ ...filters, bookId: created.id }, data.defaultYear)}` as "/",
      ),
      { invalidateAll: true },
    );
  }

  async function apply(patch: Partial<CostFilters>, replace = false) {
    const next = {
      ...parseCostFilters(
        new URLSearchParams(location.search),
        data.defaultYear,
      ),
      ...patch,
    };
    // Every year is only offered for the review list, and a year or a month picked by hand ends it.
    if (patch.allYears === undefined && (patch.year || patch.month)) {
      next.allYears = false;
    }
    next.allYears = next.allYears && next.reviewNeeded;
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
      tagId: "",
      month: "",
      reviewNeeded: false,
      allYears: false,
    });
  }

  const all = $derived({ value: "", label: m.costs_filter_all() });
  const yearChoices = $derived([
    ...(filters.reviewNeeded
      ? [{ value: "all", label: m.costs_year_all() }]
      : []),
    ...yearOptions(data.defaultYear, filters.year).map((year) => ({
      value: String(year),
      label: String(year),
    })),
  ]);
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
  const tagOptions = $derived([
    all,
    ...data.tags.map((t) => ({ value: t.id, label: t.name })),
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
      <Button href={resolve("/costs/receipts")} variant="outline" size="lg">
        <ReceiptTextIcon />
        {m.costs_receipts()}
        {#if data.pendingReceipts !== null && data.pendingReceipts > 0}
          <span
            class="bg-warning/15 text-warning rounded-full px-1.5 text-xs tabular-nums"
            aria-hidden="true">{data.pendingReceipts}</span
          >
          <span class="sr-only"
            >{m.costs_receipts_pending({
              count: data.pendingReceipts,
            })}</span
          >
        {/if}
      </Button>
      <Button
        href={csvHref}
        download
        data-sveltekit-reload
        variant="outline"
        size="lg"
        title={csvHint}
      >
        <DownloadIcon />
        {m.costs_csv({ year: filters.year })}
      </Button>
      {#if canWrite}
        <Button
          href={quickHref}
          variant="outline"
          size="lg"
          class="max-md:hidden"
        >
          <ZapIcon />
          {m.costs_quick()}
        </Button>
        <Button href={newHref} size="lg" class="max-md:hidden">
          <PlusIcon />
          {m.cost_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <BookSwitcher
    books={data.books}
    value={filters.bookId}
    hrefFor={bookHref}
    {canWrite}
    oncreate={() => (bookFormOpen = true)}
  />

  <div
    class="flex flex-wrap items-center gap-2"
    role="group"
    aria-label={m.costs_year()}
  >
    <Button
      variant="outline"
      size="icon-lg"
      aria-label={m.costs_year_prev()}
      disabled={filters.allYears || filters.year <= MIN_YEAR}
      onclick={() => setYear(filters.year - 1)}
    >
      <ChevronLeftIcon />
    </Button>
    <OptionSelect
      id="costs-year"
      class={cn("w-28 font-medium tabular-nums", filters.allYears && "w-40")}
      value={filters.allYears ? "all" : String(filters.year)}
      options={yearChoices}
      onchange={(v) =>
        v === "all" ? void apply({ allYears: true }) : setYear(Number(v))}
    />
    <Button
      variant="outline"
      size="icon-lg"
      aria-label={m.costs_year_next()}
      disabled={filters.allYears || filters.year >= MAX_YEAR}
      onclick={() => setYear(filters.year + 1)}
    >
      <ChevronRightIcon />
    </Button>
  </div>

  <CostsSummary
    summary={data.summary}
    balances={data.balances}
    userId={data.user.id}
    {balancesHref}
    asset={summaryAsset}
    bookName={book?.name}
    tagName={tag?.name}
    {reviewHref}
  />

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
          {#if showReviewFilter}
            <Button
              variant="outline"
              size="lg"
              aria-pressed={filters.reviewNeeded}
              class={cn(
                filters.reviewNeeded &&
                  "border-warning/50 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning",
              )}
              onclick={() => apply({ reviewNeeded: !filters.reviewNeeded })}
            >
              <EyeIcon />
              {m.costs_filter_review()}
              <span class="text-xs tabular-nums">{reviewCount}</span>
            </Button>
          {/if}
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
            {#if data.tags.length > 0}
              <div class="flex flex-col gap-2">
                <Label for="f-tag">{m.costs_filter_tag()}</Label>
                <OptionSelect
                  id="f-tag"
                  value={filters.tagId}
                  options={tagOptions}
                  onchange={(v) => apply({ tagId: v })}
                />
              </div>
            {/if}
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

      {#if canMove && (data.costs.length > 0 || assetName)}
        <div class="flex flex-wrap items-center gap-2">
          {#if selecting}
            <Button variant="outline" size="lg" onclick={toggleAll}>
              {allSelected ? m.costs_select_none() : m.costs_select_all()}
            </Button>
            <Button variant="ghost" size="lg" onclick={stopSelecting}>
              {m.costs_select_done()}
            </Button>
          {:else}
            {#if data.costs.length > 0}
              <Button
                variant="outline"
                size="lg"
                onclick={() => (selecting = true)}
              >
                <ListChecksIcon />
                {m.costs_select()}
              </Button>
            {/if}
            {#if assetName}
              <Button variant="outline" size="lg" onclick={moveAssetEntries}>
                <ArrowRightLeftIcon />
                {m.costs_move_asset()}
              </Button>
            {/if}
          {/if}
        </div>
        {#if selecting && data.costs.length > MOVE_COSTS_MAX_IDS}
          <p class="text-muted-foreground -mt-2 text-xs text-pretty">
            {m.costs_select_limit({ max: MOVE_COSTS_MAX_IDS })}
          </p>
        {/if}
      {/if}

      {#if data.costs.length === 0}
        {#if filters.reviewNeeded && activeCount === 0 && filters.q === ""}
          <EmptyState
            icon={EyeIcon}
            title={m.costs_empty_review_title()}
            description={m.costs_empty_review_body()}
          >
            {#snippet actions()}
              <Button variant="outline" onclick={reset}>
                {m.tasks_filter_reset()}
              </Button>
            {/snippet}
          </EmptyState>
        {:else if filtered}
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
            title={book
              ? m.costs_empty_book_title({
                  year: filters.year,
                  name: book.name,
                })
              : m.costs_empty_title({ year: filters.year })}
            description={m.costs_empty_body()}
          >
            {#snippet actions()}
              {#if canWrite}
                <Button href={quickHref}>
                  <ZapIcon />
                  {m.costs_quick()}
                </Button>
                <Button href={newHref} variant="outline">
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
              <CostRow
                {cost}
                showBook={!filters.bookId}
                {selecting}
                selected={selected.has(cost.id)}
                ontoggle={() => toggle(cost.id)}
              />
            {/each}
          </ul>
        </Card.Root>

        <Card.Root class="gap-0 py-0 max-lg:hidden">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                {#if selecting}
                  <Table.Head class="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label={m.costs_select_all()}
                    />
                  </Table.Head>
                {/if}
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
                <Table.Row
                  class={cn("relative", selecting && "cursor-pointer")}
                  onclick={selecting ? () => toggle(cost.id) : undefined}
                >
                  {#if selecting}
                    <Table.Cell class="w-10">
                      <Checkbox
                        checked={selected.has(cost.id)}
                        onCheckedChange={() => toggle(cost.id)}
                        onclick={(event) => event.stopPropagation()}
                        aria-label={m.costs_select_row({ title: cost.title })}
                      />
                    </Table.Cell>
                  {/if}
                  <Table.Cell class="text-muted-foreground tabular-nums"
                    >{formatDay(cost.date)}</Table.Cell
                  >
                  <Table.Cell class="max-w-sm whitespace-normal">
                    {#if selecting}
                      <span class="font-medium wrap-anywhere">{cost.title}</span
                      >
                    {:else}
                      <a
                        href={resolve(`/costs/${cost.id}` as "/")}
                        class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm font-medium wrap-anywhere outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                        >{cost.title}</a
                      >
                    {/if}
                    {#if cost.payee || place || !filters.bookId}
                      <span
                        class="text-muted-foreground mt-0.5 block text-xs wrap-anywhere"
                        >{[
                          cost.payee,
                          place,
                          filters.bookId ? "" : cost.bookName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}</span
                      >
                    {/if}
                    <CostFlags {cost} class="mt-1.5" />
                    <TagChips tags={cost.tags} limit={4} class="mt-1.5" />
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

{#if selecting}
  <div
    class="bg-background sticky bottom-[calc(var(--bottom-nav,0px)+env(safe-area-inset-bottom)+0.5rem)] z-30 -mt-2 flex items-center gap-3 rounded-xl border p-3 shadow-lg"
    role="region"
    aria-label={m.costs_selection()}
  >
    <p class="min-w-0 flex-1 text-sm font-medium" aria-live="polite">
      {m.costs_selected_count({ count: selected.size })}
    </p>
    <Button size="lg" disabled={selected.size === 0} onclick={moveSelected}>
      <ArrowRightLeftIcon />
      {m.costs_move()}
    </Button>
  </div>
{/if}

{#if canWrite}
  {#if !selecting}
    <Fab href={quickHref} label={m.quick_fab()} />
  {/if}
  <MoveCostsDialog
    bind:open={moveOpen}
    books={data.books}
    target={moveTarget}
    entries={moveTarget && "ids" in moveTarget ? selectedEntries : []}
    {assetName}
    onmoved={moved}
  />
  <BookFormDialog
    bind:open={bookFormOpen}
    book={undefined}
    onsaved={bookCreated}
  />
{/if}
