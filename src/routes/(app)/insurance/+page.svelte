<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import UmbrellaIcon from "@lucide/svelte/icons/umbrella";
  import { resolve } from "$app/paths";
  import { INSURANCE_TYPES } from "$lib/api/enums";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Fab from "$lib/components/app/fab.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import DeadlineHint from "$lib/components/insurance/deadline-hint.svelte";
  import PolicyRow from "$lib/components/insurance/policy-row.svelte";
  import OptionSelect from "$lib/components/assets/option-select.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import { formatMoney } from "$lib/format-money";
  import { insuranceHref } from "$lib/links";
  import {
    insuranceTypeIcons,
    insuranceTypeLabels,
  } from "$lib/insurance/labels";
  import {
    annualTotal,
    emptyFilter,
    filterPolicies,
    isFiltered,
    type PolicyFilter,
  } from "$lib/insurance/list";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps, Snapshot } from "./$types";

  let { data }: PageProps = $props();

  let filter = $state<PolicyFilter>({ ...emptyFilter });

  /** Coming back from a policy keeps the search and the filters. */
  export const snapshot: Snapshot<PolicyFilter> = {
    capture: () => $state.snapshot(filter),
    restore: (value) => (filter = { ...emptyFilter, ...value }),
  };

  const typeOptions = INSURANCE_TYPES.map((type) => ({
    value: type,
    label: insuranceTypeLabels[type](),
  }));

  const shown = $derived(
    filterPolicies([...data.active, ...data.archived], filter),
  );
  const filtered = $derived(isFiltered(filter));
  const total = $derived(annualTotal(shown, data.currency));
  const nothingAtAll = $derived(
    data.active.length === 0 && data.archived.length === 0,
  );

  function reset() {
    filter = { ...emptyFilter };
  }
</script>

<svelte:head>
  <title>{m.nav_insurance()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.insurance_title()}
    description={m.insurance_description()}
  >
    {#snippet actions()}
      <Button href={resolve("/insurance/new")} size="lg" class="max-md:hidden">
        <PlusIcon />{m.insurance_new()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if nothingAtAll}
    <EmptyState
      icon={UmbrellaIcon}
      title={m.insurance_empty_title()}
      description={m.insurance_empty_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/insurance/new")}>
          <PlusIcon />{m.insurance_new()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <section class="flex flex-col gap-3" aria-label={m.insurance_filters()}>
      <div class="relative">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          class="h-10 ps-9"
          placeholder={m.insurance_search_placeholder()}
          aria-label={m.insurance_search_label()}
          autocomplete="off"
          bind:value={filter.q}
        />
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OptionSelect
          options={typeOptions}
          bind:value={filter.type}
          noneLabel={m.insurance_filter_type_all()}
        />
        {#if data.archived.length > 0}
          <div class="flex h-10 items-center gap-2">
            <Switch id="insurance-archived" bind:checked={filter.archived} />
            <Label for="insurance-archived" class="font-normal">
              {m.insurance_show_archived()}
            </Label>
          </div>
        {/if}
      </div>
      <div
        class="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs"
      >
        <p aria-live="polite">
          {m.insurance_count({ count: shown.length })}
          {#if !filter.archived && shown.length > 0}
            <span aria-hidden="true">·</span>
            <span class="text-foreground font-medium tabular-nums"
              >{m.insurance_total_per_year({
                amount: formatMoney(total.totalMinor, data.currency),
              })}</span
            >
          {/if}
        </p>
        {#if filtered}
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            onclick={reset}
          >
            {m.insurance_filter_reset()}
          </Button>
        {/if}
      </div>
      {#if !filter.archived && total.otherCurrencyCount > 0}
        <p class="text-muted-foreground -mt-1 text-xs text-pretty">
          {m.insurance_total_other_currency({
            count: total.otherCurrencyCount,
          })}
        </p>
      {/if}
    </section>

    {#if shown.length === 0}
      {#if filtered}
        <EmptyState
          icon={SearchXIcon}
          title={m.insurance_empty_filtered_title()}
          description={m.insurance_empty_filtered_body()}
        >
          {#snippet actions()}
            <Button variant="outline" onclick={reset}>
              {m.insurance_filter_reset()}
            </Button>
          {/snippet}
        </EmptyState>
      {:else if filter.archived}
        <EmptyState
          icon={UmbrellaIcon}
          title={m.insurance_empty_archived_title()}
          description={m.insurance_empty_archived_body()}
        />
      {:else}
        <EmptyState
          icon={UmbrellaIcon}
          title={m.insurance_empty_title()}
          description={m.insurance_empty_body()}
        >
          {#snippet actions()}
            <Button href={resolve("/insurance/new")}>
              <PlusIcon />{m.insurance_new()}
            </Button>
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      <Card.Root class="gap-0 py-0 md:hidden">
        <ul class="divide-y">
          {#each shown as policy (policy.id)}
            <PolicyRow {policy} today={data.today} />
          {/each}
        </ul>
      </Card.Root>

      <Card.Root class="gap-0 py-0 max-md:hidden">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.insurance_col_policy()}</Table.Head>
              <Table.Head>{m.insurance_col_insurer()}</Table.Head>
              <Table.Head class="text-end"
                >{m.insurance_col_premium()}</Table.Head
              >
              <Table.Head>{m.insurance_col_deadline()}</Table.Head>
              <Table.Head class="w-12"
                ><span class="sr-only">{m.comments_title()}</span></Table.Head
              >
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each shown as policy (policy.id)}
              {@const Icon = insuranceTypeIcons[policy.type]}
              <Table.Row class="relative">
                <Table.Cell class="max-w-xs font-medium whitespace-normal">
                  <a
                    href={insuranceHref(policy.id)}
                    class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 flex items-center gap-2 rounded-sm wrap-anywhere outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                  >
                    <Icon
                      class="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="min-w-0">{policy.title}</span>
                    {#if policy.archivedAt}
                      <Badge variant="secondary">{m.insurance_archived()}</Badge
                      >
                    {/if}
                  </a>
                  <span
                    class="text-muted-foreground mt-0.5 block ps-6 text-xs font-normal wrap-anywhere"
                  >
                    {insuranceTypeLabels[policy.type]()}
                    {#if policy.assets.length > 0}
                      · {policy.assets.map((asset) => asset.name).join(", ")}
                    {/if}
                  </span>
                </Table.Cell>
                <Table.Cell class="max-w-48 whitespace-normal">
                  {#if policy.insurerName}
                    <span class="wrap-anywhere">{policy.insurerName}</span>
                  {:else}
                    <span class="text-muted-foreground">–</span>
                  {/if}
                  {#if policy.policyNumber}
                    <span
                      class="text-muted-foreground block text-xs wrap-anywhere"
                      >{policy.policyNumber}</span
                    >
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-end tabular-nums">
                  {formatMoney(policy.annualPremiumMinor, policy.currency)}
                </Table.Cell>
                <Table.Cell class="whitespace-normal">
                  {#if policy.archivedAt}
                    <span class="text-muted-foreground">–</span>
                  {:else}
                    <DeadlineHint
                      deadline={policy.cancellationDeadline}
                      today={data.today}
                    />
                  {/if}
                </Table.Cell>
                <Table.Cell class="w-12 text-end">
                  <CommentCount count={policy.commentCount} />
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>
    {/if}
  {/if}
</div>

<Fab href={resolve("/insurance/new")} label={m.insurance_new()} />
