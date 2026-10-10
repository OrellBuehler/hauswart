<script lang="ts">
  import CircleCheckBigIcon from "@lucide/svelte/icons/circle-check-big";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { SvelteSet } from "svelte/reactivity";
  import { slide } from "svelte/transition";
  import { resolve } from "$app/paths";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import DefectsCard from "$lib/components/dashboard/defects-card.svelte";
  import FinanceInboxCard from "$lib/components/dashboard/finance-inbox-card.svelte";
  import OrderNowCard from "$lib/components/dashboard/order-now-card.svelte";
  import WarrantiesCard from "$lib/components/dashboard/warranties-card.svelte";
  import CompletionItem from "$lib/components/tasks/completion-item.svelte";
  import PreparationRow from "$lib/components/tasks/preparation-row.svelte";
  import TaskRow from "$lib/components/tasks/task-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { motion } from "$lib/motion";
  import { m } from "$lib/paraglide/messages";
  import { rowFromDashboard } from "$lib/tasks/row";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const dashboard = $derived(data.dashboard);
  const today = $derived(dashboard.today);
  const name = $derived(data.user.displayName || data.user.username);

  const hidden = new SvelteSet<string>();
  const LATER_PREVIEW = 5;
  let laterExpanded = $state(false);

  const buckets = $derived([
    {
      id: "overdue",
      title: m.dashboard_overdue(),
      tone: "text-destructive",
      items: dashboard.upcoming.overdue,
    },
    {
      id: "today",
      title: m.dashboard_today(),
      tone: "",
      items: dashboard.upcoming.today,
    },
    {
      id: "week",
      title: m.dashboard_this_week(),
      tone: "",
      items: dashboard.upcoming.thisWeek,
    },
  ]);
  const later = $derived(dashboard.upcoming.later);
  const laterShown = $derived(
    laterExpanded ? later : later.slice(0, LATER_PREVIEW),
  );
  const signal = $derived(dashboard.upcoming.signalBased);
  const preparations = $derived(dashboard.preparations);

  const nothingToDo = $derived(
    buckets.every((b) => b.items.length === 0) &&
      later.length === 0 &&
      signal.length === 0 &&
      preparations.length === 0,
  );

  const tiles = $derived([
    {
      key: "overdue",
      label: m.dashboard_overdue(),
      value: dashboard.counts.overdue,
      tone: dashboard.counts.overdue > 0 ? "text-destructive" : "",
    },
    {
      key: "today",
      label: m.dashboard_today(),
      value: dashboard.counts.today,
      tone: "",
    },
    {
      key: "week",
      label: m.dashboard_this_week(),
      value: dashboard.counts.thisWeek,
      tone: "",
    },
    {
      key: "preparations",
      label: m.dashboard_preparations(),
      value: dashboard.counts.preparations,
      tone: "",
    },
  ]);

  const now = $derived(Date.parse(dashboard.generatedAt));
</script>

<svelte:head>
  <title>{m.dashboard_title()} · {m.app_name()}</title>
</svelte:head>

{#snippet taskList(items: typeof dashboard.upcoming.today)}
  <ul class="divide-y">
    {#each items.filter((t) => !hidden.has(t.taskId)) as task (task.taskId)}
      <li out:slide={{ duration: motion(180) }}>
        <TaskRow
          task={rowFromDashboard(task)}
          {today}
          onstart={() => hidden.add(task.taskId)}
          onfail={() => hidden.delete(task.taskId)}
          onsettled={() => hidden.delete(task.taskId)}
        />
      </li>
    {/each}
  </ul>
{/snippet}

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.dashboard_greeting({ name })}
    description={m.dashboard_subtitle()}
  >
    {#snippet actions()}
      <Button href={resolve("/tasks/new")} size="lg">
        <PlusIcon />
        {m.task_new()}
      </Button>
    {/snippet}
  </PageHeader>

  <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#each tiles as tile (tile.key)}
      <div class="bg-card shadow-card min-w-0 rounded-xl border px-4 py-3">
        <dt class="text-muted-foreground text-xs font-medium break-words">
          {tile.label}
        </dt>
        <dd class={cn("mt-1 text-2xl font-semibold tabular-nums", tile.tone)}>
          {tile.value}
        </dd>
      </div>
    {/each}
  </dl>

  <div
    class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="min-w-0">
      <Card.Header>
        <Card.Title>{m.dashboard_soon_title()}</Card.Title>
        <Card.Description>{m.dashboard_soon_description()}</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-6">
        {#if nothingToDo}
          <EmptyState
            icon={CircleCheckBigIcon}
            title={m.dashboard_empty_title()}
            description={m.dashboard_empty_body()}
          >
            {#snippet actions()}
              <Button href={resolve("/tasks/new")}>
                <PlusIcon />
                {m.task_new()}
              </Button>
            {/snippet}
          </EmptyState>
        {/if}

        {#each buckets as bucket (bucket.id)}
          {#if bucket.items.length > 0}
            <section aria-labelledby={`bucket-${bucket.id}`}>
              <h3
                id={`bucket-${bucket.id}`}
                class={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  bucket.tone,
                )}
              >
                {bucket.title}
                <span
                  class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                  >{bucket.items.length}</span
                >
              </h3>
              {@render taskList(bucket.items)}
            </section>
          {/if}
        {/each}

        {#if later.length > 0}
          <section aria-labelledby="bucket-later">
            <h3
              id="bucket-later"
              class="flex items-center gap-2 text-sm font-semibold"
            >
              {m.dashboard_later()}
              <span
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                >{later.length}</span
              >
            </h3>
            {@render taskList(laterShown)}
            {#if later.length > LATER_PREVIEW}
              <Button
                variant="ghost"
                class="mt-1 h-10"
                aria-expanded={laterExpanded}
                onclick={() => (laterExpanded = !laterExpanded)}
              >
                {laterExpanded
                  ? m.dashboard_show_less()
                  : m.dashboard_show_all({ count: later.length })}
              </Button>
            {/if}
          </section>
        {/if}

        {#if signal.length > 0}
          <section aria-labelledby="bucket-signal">
            <h3
              id="bucket-signal"
              class="flex items-center gap-2 text-sm font-semibold"
            >
              {m.dashboard_signal()}
              <span
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                >{signal.length}</span
              >
            </h3>
            {@render taskList(signal)}
          </section>
        {/if}

        {#if preparations.length > 0}
          <section aria-labelledby="bucket-preparations">
            <h3
              id="bucket-preparations"
              class="flex items-center gap-2 text-sm font-semibold"
            >
              {m.dashboard_preparations()}
              <span
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                >{preparations.length}</span
              >
            </h3>
            <ul class="divide-y">
              {#each preparations.filter((p) => !hidden.has(p.prepId)) as prep (prep.prepId)}
                <li out:slide={{ duration: motion(180) }}>
                  <PreparationRow
                    taskId={prep.taskId}
                    taskTitle={prep.taskTitle}
                    prepId={prep.prepId}
                    title={prep.title}
                    date={prep.date}
                    {today}
                    onstart={() => hidden.add(prep.prepId)}
                    onfail={() => hidden.delete(prep.prepId)}
                    onsettled={() => hidden.delete(prep.prepId)}
                  />
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </Card.Content>
    </Card.Root>

    <div class="flex min-w-0 flex-col gap-6">
      <!-- On phones the cards that ask for something come first; the history is the last thing. -->
      <Card.Root class="max-lg:order-last">
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <HistoryIcon
              class="text-muted-foreground size-4"
              aria-hidden="true"
            />
            {m.dashboard_recent_title()}
          </Card.Title>
        </Card.Header>
        <Card.Content>
          {#if dashboard.recentCompletions.length === 0}
            <p class="text-muted-foreground text-sm">
              {m.dashboard_recent_empty()}
            </p>
          {:else}
            <ul class="divide-y">
              {#each dashboard.recentCompletions as completion (completion.id)}
                <li>
                  <CompletionItem {completion} showTask {now} />
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      {#if dashboard.pendingFinanceSuggestions > 0}
        <FinanceInboxCard count={dashboard.pendingFinanceSuggestions} />
      {/if}
      {#if dashboard.openDefects.length > 0}
        <DefectsCard defects={dashboard.openDefects} {today} />
      {/if}
      {#if dashboard.expiringWarranties.length > 0}
        <WarrantiesCard warranties={dashboard.expiringWarranties} />
      {/if}
      {#if dashboard.orderNow.length > 0}
        <OrderNowCard items={dashboard.orderNow} {today} />
      {/if}
    </div>
  </div>
</div>
