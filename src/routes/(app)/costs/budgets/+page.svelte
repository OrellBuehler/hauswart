<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlayIcon from "@lucide/svelte/icons/play";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostBudget } from "$lib/api/schemas/cost-budgets";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import BudgetCard from "$lib/components/costs/budget-card.svelte";
  import BudgetFormDialog from "$lib/components/costs/budget-form-dialog.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import {
    budgetPeriodLabels,
    budgetScope,
    budgetViewLabel,
    budgetViewQuery,
    isCurrentView,
    itemsForPeriod,
    shiftBudgetView,
    type BudgetView,
  } from "$lib/costs/budgets";
  import { formatMoney } from "$lib/format-money";
  import { apiErrorMessage } from "$lib/error-message";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));
  const view = $derived(data.view);
  const items = $derived(itemsForPeriod(data.status.items, view.period));
  const paused = $derived(
    data.budgets.filter((b) => !b.active && b.period === view.period),
  );
  const current = $derived(isCurrentView(view, data.today));
  const prev = $derived(shiftBudgetView(view, -1));
  const next = $derived(shiftBudgetView(view, 1));
  const periodOptions = [
    { value: "month" as const, label: budgetPeriodLabels.month() },
    { value: "year" as const, label: budgetPeriodLabels.year() },
  ];

  let formOpen = $state(false);
  let editing = $state<CostBudget | undefined>();
  let deleteOpen = $state(false);
  let deleting = $state<CostBudget | undefined>();
  let busy = $state(false);
  let actionError = $state<string | undefined>();

  async function show(target: BudgetView | null) {
    if (!target) return;
    await goto(
      resolve(`/costs/budgets${budgetViewQuery(target, data.today)}` as "/"),
      { keepFocus: true, noScroll: true },
    );
  }

  function nameOf(budget: CostBudget): string {
    const scope = budgetScope(budget);
    return `${scope.title} · ${scope.subtitle}`;
  }

  function openCreate() {
    editing = undefined;
    formOpen = true;
  }

  function openEdit(budget: CostBudget) {
    editing = budget;
    formOpen = true;
  }

  function askDelete(budget: CostBudget) {
    deleting = budget;
    deleteOpen = true;
  }

  async function remove() {
    const budget = deleting;
    if (!budget) return;
    await api.call(endpoints.costBudgetsDelete, { params: { id: budget.id } });
    toast.success(m.budget_deleted_toast({ name: nameOf(budget) }));
    await invalidateAfterOverlay();
  }

  async function setActive(budget: CostBudget, active: boolean) {
    if (busy) return;
    busy = true;
    actionError = undefined;
    try {
      await api.call(endpoints.costBudgetsUpdate, {
        params: { id: budget.id },
        body: { active },
      });
      toast.success(
        active
          ? m.budget_resumed_toast({ name: nameOf(budget) })
          : m.budget_paused_toast({ name: nameOf(budget) }),
      );
      await invalidateAll();
    } catch (err) {
      actionError = apiErrorMessage(err);
      toast.error(actionError);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{m.budgets_title()} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.cost_back()}
    </a>
  </div>

  <PageHeader title={m.budgets_title()} description={m.budgets_description()}>
    {#snippet actions()}
      {#if canWrite}
        <Button size="lg" class="max-sm:w-full" onclick={openCreate}>
          <PlusIcon />
          {m.budgets_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if data.budgets.length === 0}
    <EmptyState
      icon={GaugeIcon}
      title={m.budgets_empty_title()}
      description={m.budgets_empty_body()}
    >
      {#snippet actions()}
        {#if canWrite}
          <Button onclick={openCreate}><PlusIcon />{m.budgets_new()}</Button>
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-3">
      <Segmented
        options={periodOptions}
        value={view.period}
        label={m.budgets_view()}
        onchange={(period) => show({ ...view, period })}
        class="sm:w-fit"
      />
      <div
        class="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={m.budgets_period_nav()}
      >
        <Button
          variant="outline"
          size="icon-lg"
          aria-label={view.period === "year"
            ? m.costs_year_prev()
            : m.budgets_prev_month()}
          disabled={prev === null}
          onclick={() => show(prev)}
        >
          <ChevronLeftIcon />
        </Button>
        <p
          class="min-w-32 flex-1 text-center text-base font-semibold tabular-nums sm:flex-none"
          aria-live="polite"
        >
          {budgetViewLabel(view)}
        </p>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label={view.period === "year"
            ? m.costs_year_next()
            : m.budgets_next_month()}
          disabled={next === null}
          onclick={() => show(next)}
        >
          <ChevronRightIcon />
        </Button>
        {#if !current}
          <Button
            variant="ghost"
            size="lg"
            onclick={() =>
              show({
                ...view,
                year: Number(data.today.slice(0, 4)),
                month: Number(data.today.slice(5, 7)),
              })}
          >
            {view.period === "year"
              ? m.budgets_today_year()
              : m.budgets_today_month()}
          </Button>
        {/if}
      </div>
    </div>

    {#if actionError}
      <p class="text-destructive text-sm" role="alert">{actionError}</p>
    {/if}

    {#if items.length === 0}
      <EmptyState
        icon={GaugeIcon}
        title={view.period === "year"
          ? m.budgets_empty_year_title()
          : m.budgets_empty_month_title()}
        description={view.period === "year"
          ? m.budgets_empty_year_body()
          : m.budgets_empty_month_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            <Button variant="outline" onclick={openCreate}
              ><PlusIcon />{m.budgets_new()}</Button
            >
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
        {m.budgets_count({ count: items.length })}
      </p>
      <ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {#each items as item (item.budget.id)}
          <BudgetCard
            {item}
            {canWrite}
            onedit={() => openEdit(item.budget)}
            onpause={() => setActive(item.budget, false)}
            ondelete={() => askDelete(item.budget)}
          />
        {/each}
      </ul>
    {/if}

    {#if paused.length > 0}
      <section class="flex flex-col gap-2" aria-labelledby="budgets-paused">
        <h2
          id="budgets-paused"
          class="text-muted-foreground text-sm font-semibold"
        >
          {m.budgets_inactive_title()}
        </h2>
        <p class="text-muted-foreground -mt-1 text-xs text-pretty">
          {m.budgets_inactive_hint()}
        </p>
        <ul class="divide-y rounded-xl border">
          {#each paused as budget (budget.id)}
            {@const scope = budgetScope(budget)}
            <li class="flex min-w-0 items-center gap-3 p-3 sm:px-4">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-pretty wrap-anywhere">
                  {scope.title}
                  <Badge variant="outline" class="ms-1 align-middle"
                    >{m.budgets_inactive_row()}</Badge
                  >
                </p>
                <p class="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                  {scope.subtitle}
                  <span aria-hidden="true">·</span>
                  {budgetPeriodLabels[budget.period]()}
                </p>
              </div>
              <p
                class="shrink-0 text-sm font-medium whitespace-nowrap tabular-nums"
              >
                {formatMoney(budget.amountMinor, budget.currency)}
              </p>
              {#if canWrite}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-lg"
                        class="-me-2"
                        aria-label={m.budget_actions({ name: nameOf(budget) })}
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onSelect={() => setActive(budget, true)}>
                      <PlayIcon />{m.budgets_resume()}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => openEdit(budget)}>
                      <PencilIcon />{m.common_edit()}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      variant="destructive"
                      onclick={() => askDelete(budget)}
                    >
                      <Trash2Icon />{m.common_delete()}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <p class="text-muted-foreground text-xs text-pretty">
      {m.budgets_legend({ percent: data.status.warningPercent })}
    </p>
  {/if}
</div>

{#if canWrite}
  <BudgetFormDialog
    bind:open={formOpen}
    budget={editing}
    books={data.books}
    currency={data.currency}
    defaultPeriod={view.period}
    onsaved={invalidateAfterOverlay}
  />
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.budget_delete_title()}
    description={m.budget_delete_description({
      name: deleting ? nameOf(deleting) : "",
    })}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
