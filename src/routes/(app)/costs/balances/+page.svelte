<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import HandCoinsIcon from "@lucide/svelte/icons/hand-coins";
  import InfoIcon from "@lucide/svelte/icons/info";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Settlement } from "$lib/api/schemas/settlements";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import BookSwitcher from "$lib/components/costs/book-switcher.svelte";
  import SettlementDialog from "$lib/components/costs/settlement-dialog.svelte";
  import SuggestedPayments from "$lib/components/costs/suggested-payments.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import {
    dismissHistoryHint,
    historyHintDismissed,
  } from "$lib/costs/balance-hint";
  import {
    balanceState,
    balanceWording,
    crossBookNote,
    personName,
    viewerLine,
    type BalanceTone,
    type SuggestedPayment,
  } from "$lib/costs/balances";
  import { rememberBook } from "$lib/costs/book-memory";
  import { MAX_YEAR, MIN_YEAR, yearOptions } from "$lib/costs/filters";
  import {
    draftFromSuggestion,
    settlementFilterQuery,
    settlementFiltersActive,
    type SettlementDraft,
    type SettlementFilters,
  } from "$lib/costs/settlements";
  import { formatDay } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const balances = $derived(data.balances);
  const canWrite = $derived(data.scopes.includes("costs:write"));
  const book = $derived(data.books.find((b) => b.id === filters.bookId));
  const crossBook = $derived(crossBookNote(balances));
  const status = $derived(balanceState(balances));
  const you = $derived(viewerLine(balances, data.user.id));
  const money = (value: number) => formatMoney(value, balances.currency);
  const filtered = $derived(settlementFiltersActive(filters));

  const tones: Record<BalanceTone, string> = {
    credit: "text-success",
    debit: "text-destructive",
    even: "text-muted-foreground",
  };

  let dialogOpen = $state(false);
  let editing = $state<Settlement | undefined>();
  let prefill = $state<SettlementDraft | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<Settlement | undefined>();
  let hintReady = $state(false);
  let hintDismissed = $state(false);

  const showHistoryHint = $derived(
    hintReady &&
      !hintDismissed &&
      !data.anySettlement &&
      status === "open" &&
      canWrite,
  );

  onMount(() => {
    hintDismissed = historyHintDismissed(data.user.id);
    hintReady = true;
  });

  $effect(() => {
    if (data.bookExplicit) rememberBook(data.user.id, data.filters.bookId);
  });

  function address(next: SettlementFilters): string {
    return resolve(`/costs/balances${settlementFilterQuery(next)}` as "/");
  }

  async function apply(patch: Partial<SettlementFilters>) {
    await goto(
      resolve(
        `/costs/balances${settlementFilterQuery({ ...filters, ...patch })}` as "/",
      ),
      { keepFocus: true, noScroll: true },
    );
  }

  function record(payment: SuggestedPayment) {
    editing = undefined;
    prefill = draftFromSuggestion(payment, {
      bookId: filters.bookId,
      today: data.today,
      currency: balances.currency,
    });
    dialogOpen = true;
  }

  function recordNew() {
    editing = undefined;
    prefill = undefined;
    dialogOpen = true;
  }

  function edit(settlement: Settlement) {
    editing = settlement;
    prefill = undefined;
    dialogOpen = true;
  }

  function askDelete(settlement: Settlement) {
    deleting = settlement;
    deleteOpen = true;
  }

  async function remove() {
    const settlement = deleting;
    if (!settlement) return;
    await api.call(endpoints.settlementsDelete, {
      params: { id: settlement.id },
    });
    toast.success(m.settlement_deleted_toast());
    await invalidateAfterOverlay();
  }

  function dismissHint() {
    dismissHistoryHint(data.user.id);
    hintDismissed = true;
  }

  const yearChoices = $derived([
    { value: "", label: m.settlements_all_years() },
    ...yearOptions(Number(data.today.slice(0, 4)), filters.year ?? 0)
      .filter((year) => year >= MIN_YEAR && year <= MAX_YEAR)
      .map((year) => ({ value: String(year), label: String(year) })),
  ]);
  const personChoices = $derived([
    { value: "", label: m.settlements_all_people() },
    ...data.people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);
  const nameOf = (id: string) =>
    data.people.find((p) => p.id === id)?.displayName ??
    m.cost_person_unknown();
</script>

<svelte:head>
  <title>{m.balances_title()} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.balances_back()}
    </a>
  </div>

  <PageHeader title={m.balances_title()} description={m.balances_description()}>
    {#snippet actions()}
      {#if canWrite}
        <Button size="lg" onclick={recordNew}>
          <PlusIcon />
          {m.balances_record_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <BookSwitcher
    books={data.books}
    value={filters.bookId}
    hrefFor={(bookId) => address({ ...filters, bookId })}
  />

  {#if book}
    <p
      class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-pretty"
    >
      <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 wrap-anywhere"
        >{crossBook
          ? `${m.balances_scope_book_only({ name: book.name })} ${crossBook}`
          : m.balances_scope_book({ name: book.name })}</span
      >
    </p>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.balances_people_title()}</Card.Title>
      <Card.Description>{m.balances_explain()}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#if you}
        <p
          class={cn(
            "text-xl font-semibold tabular-nums sm:text-2xl",
            tones[you.tone],
          )}
          aria-live="polite"
        >
          {you.text}
        </p>
      {/if}

      {#if status === "empty"}
        <p class="text-muted-foreground flex items-start gap-2 text-pretty">
          <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {m.balances_nothing()}
        </p>
      {:else}
        <ul class="divide-y rounded-xl border">
          {#each balances.people as person (person.userId)}
            {@const wording = balanceWording(
              person.balanceMinor,
              balances.currency,
            )}
            <li class="flex flex-col gap-2 p-3 sm:px-4">
              <div
                class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
              >
                <span class="flex min-w-0 items-center gap-2 font-medium">
                  <span class="wrap-anywhere"
                    >{personName(person.userName)}</span
                  >
                  {#if person.userId === data.user.id}
                    <Badge variant="secondary">{m.balances_you_badge()}</Badge>
                  {/if}
                </span>
                <span
                  class={cn(
                    "text-end font-semibold tabular-nums",
                    tones[wording.tone],
                  )}>{wording.text}</span
                >
              </div>
              <dl
                class="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4"
              >
                <div class="flex min-w-0 justify-between gap-2 sm:block">
                  <dt>{m.balances_paid()}</dt>
                  <dd class="text-foreground tabular-nums">
                    {money(person.paidMinor)}
                  </dd>
                </div>
                <div class="flex min-w-0 justify-between gap-2 sm:block">
                  <dt>{m.balances_share()}</dt>
                  <dd class="text-foreground tabular-nums">
                    {money(person.shareMinor)}
                  </dd>
                </div>
                <div class="flex min-w-0 justify-between gap-2 sm:block">
                  <dt>{m.balances_sent()}</dt>
                  <dd class="text-foreground tabular-nums">
                    {money(person.sentMinor)}
                  </dd>
                </div>
                <div class="flex min-w-0 justify-between gap-2 sm:block">
                  <dt>{m.balances_received()}</dt>
                  <dd class="text-foreground tabular-nums">
                    {money(person.receivedMinor)}
                  </dd>
                </div>
              </dl>
            </li>
          {/each}
        </ul>
        <p class="text-muted-foreground text-xs text-pretty">
          {m.balances_formula()}
        </p>
      {/if}

      {#if balances.unassignedPayerCount > 0}
        <p
          class="text-muted-foreground flex items-start gap-2 border-t pt-3 text-xs text-pretty"
        >
          <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span
            >{m.balances_unassigned({
              count: balances.unassignedPayerCount,
            })}</span
          >
        </p>
      {/if}
      {#if balances.otherCurrencyCount > 0}
        <p
          class="text-muted-foreground flex items-start gap-2 text-xs text-pretty"
        >
          <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span
            >{m.balances_other_currency({
              count: balances.otherCurrencyCount,
              currency: balances.currency,
            })}</span
          >
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if status !== "empty"}
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.balances_suggested_title()}</Card.Title>
        {#if status === "open"}
          <Card.Description>{m.balances_suggested_hint()}</Card.Description>
        {/if}
      </Card.Header>
      <Card.Content>
        {#if status === "open"}
          <SuggestedPayments
            payments={balances.suggestedPayments}
            currency={balances.currency}
            onrecord={canWrite ? record : undefined}
          />
        {:else}
          <p class="flex items-start gap-2 text-pretty">
            <CircleCheckIcon
              class="text-success mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {m.balances_square()}
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if showHistoryHint}
    <aside
      class="bg-muted/50 flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="history-hint-title"
    >
      <div class="flex flex-col gap-1">
        <h2 id="history-hint-title" class="text-sm font-semibold">
          {m.balances_history_title()}
        </h2>
        <p class="text-muted-foreground text-sm text-pretty">
          {m.balances_history_body()}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button onclick={recordNew}>{m.balances_record_new()}</Button>
        <Button variant="ghost" onclick={dismissHint}>
          {m.balances_history_dismiss()}
        </Button>
      </div>
    </aside>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settlements_title()}</Card.Title>
      <Card.Description>{m.settlements_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-2">
          <Label for="settlements-year">{m.settlements_filter_year()}</Label>
          <OptionSelect
            id="settlements-year"
            value={filters.year === null ? "" : String(filters.year)}
            options={yearChoices}
            onchange={(value) =>
              apply({ year: value === "" ? null : Number(value) })}
          />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <Label for="settlements-person">{m.settlements_filter_person()}</Label
          >
          <OptionSelect
            id="settlements-person"
            value={filters.person}
            options={personChoices}
            onchange={(value) => apply({ person: value })}
          />
        </div>
      </div>

      {#if book}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.settlements_book_note()}
        </p>
      {/if}

      <p class="text-muted-foreground -mb-1 text-sm" aria-live="polite">
        {m.settlements_count({ count: data.settlements.length })}
      </p>

      {#if data.settlements.length === 0}
        <EmptyState
          icon={HandCoinsIcon}
          title={filtered
            ? m.settlements_empty_filtered_title()
            : m.settlements_empty_title()}
          description={filtered
            ? m.costs_empty_filtered_body()
            : m.settlements_empty_body()}
        >
          {#snippet actions()}
            {#if filtered}
              <Button
                variant="outline"
                onclick={() => apply({ year: null, person: "" })}
              >
                {m.tasks_filter_reset()}
              </Button>
            {:else if canWrite}
              <Button onclick={recordNew}>
                <PlusIcon />
                {m.balances_record_new()}
              </Button>
            {/if}
          {/snippet}
        </EmptyState>
      {:else}
        <ul class="divide-y rounded-xl border">
          {#each data.settlements as settlement (settlement.id)}
            {@const from = settlement.fromName ?? nameOf(settlement.fromUserId)}
            {@const to = settlement.toName ?? nameOf(settlement.toUserId)}
            <li class="flex min-w-0 items-start gap-3 p-3 sm:px-4">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium wrap-anywhere">
                  {m.settlement_paid({ from, to })}
                </p>
                <p class="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                  <span class="tabular-nums">{formatDay(settlement.date)}</span>
                  <span aria-hidden="true">·</span>
                  {settlement.bookName ?? m.costbook_all()}
                  {#if settlement.note}
                    <span aria-hidden="true">·</span>
                    {settlement.note}
                  {/if}
                </p>
              </div>
              <span
                class="shrink-0 pt-0.5 text-end text-sm font-semibold whitespace-nowrap tabular-nums"
                >{formatMoney(
                  settlement.amountMinor,
                  settlement.currency,
                )}</span
              >
              {#if canWrite}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-lg"
                        class="-my-2 -me-2"
                        aria-label={m.settlement_actions({ from, to })}
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onclick={() => edit(settlement)}>
                      <PencilIcon />{m.common_edit()}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      variant="destructive"
                      onclick={() => askDelete(settlement)}
                    >
                      <Trash2Icon />{m.common_delete()}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

{#if canWrite}
  <SettlementDialog
    bind:open={dialogOpen}
    settlement={editing}
    {prefill}
    people={data.people}
    books={data.books}
    defaults={{
      today: data.today,
      currency: balances.currency,
      bookId: filters.bookId,
      fromUserId: data.user.id,
    }}
    onsaved={invalidateAfterOverlay}
  />
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.settlement_delete_title()}
    description={deleting
      ? m.settlement_delete_description({
          from: deleting.fromName ?? nameOf(deleting.fromUserId),
          to: deleting.toName ?? nameOf(deleting.toUserId),
          amount: formatMoney(deleting.amountMinor, deleting.currency),
        })
      : ""}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
