<script lang="ts">
  import { goto } from "$app/navigation";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PuzzleIcon from "@lucide/svelte/icons/puzzle";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import ShoppingCartIcon from "@lucide/svelte/icons/shopping-cart";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import OrderNowItem from "$lib/components/parts/order-now-item.svelte";
  import PartFormDialog from "$lib/components/parts/part-form-dialog.svelte";
  import PartRow from "$lib/components/parts/part-row.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { partHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { stockLevel } from "$lib/parts/stock";
  import { cn } from "$lib/utils";
  import type { PageProps, Snapshot } from "./$types";

  let { data }: PageProps = $props();

  let q = $state("");
  let lowOnly = $state(false);
  let showArchived = $state(false);
  let createOpen = $state(false);

  /** Coming back from a part keeps the search and filters. */
  export const snapshot: Snapshot<{
    q: string;
    lowOnly: boolean;
    showArchived: boolean;
  }> = {
    capture: () => ({ q, lowOnly, showArchived }),
    restore: (value) => {
      q = value.q;
      lowOnly = value.lowOnly;
      showArchived = value.showArchived;
    },
  };

  const query = $derived(q.trim().toLowerCase());
  const hasArchived = $derived(data.parts.some((part) => part.archivedAt));
  const active = $derived(data.parts.filter((part) => !part.archivedAt));
  const visible = $derived(
    data.parts.filter((part) => {
      if (part.archivedAt && !showArchived) return false;
      if (lowOnly && stockLevel(part) === "ok") return false;
      if (!query) return true;
      return [part.name, part.partNumber, part.supplier, part.notes].some(
        (value) => value?.toLowerCase().includes(query),
      );
    }),
  );
  const lowCount = $derived(
    active.filter((part) => stockLevel(part) !== "ok").length,
  );
  const filtered = $derived(lowOnly || query !== "");

  function reset() {
    q = "";
    lowOnly = false;
  }
</script>

<svelte:head>
  <title>{m.nav_parts()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_parts()} description={m.parts_description()}>
    {#snippet actions()}
      <Button size="lg" onclick={() => (createOpen = true)}>
        <PlusIcon />{m.parts_create()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if data.orderNow.length > 0}
    <section
      class="border-warning/40 bg-warning/5 rounded-xl border"
      aria-labelledby="order-now-title"
    >
      <div class="flex items-center gap-2 px-4 pt-4 pb-1">
        <ShoppingCartIcon class="text-warning size-5" aria-hidden="true" />
        <h2 id="order-now-title" class="font-semibold">
          {m.order_now_title()}
        </h2>
        <span class="text-muted-foreground text-sm tabular-nums">
          {data.orderNow.length}
        </span>
      </div>
      <p class="text-muted-foreground px-4 pb-2 text-sm text-pretty">
        {m.order_now_description()}
      </p>
      <ul class="divide-y">
        {#each data.orderNow as item (item.id)}
          <OrderNowItem {item} today={data.today} />
        {/each}
      </ul>
    </section>
  {/if}

  {#if data.parts.length === 0}
    <EmptyState
      icon={PuzzleIcon}
      title={m.parts_empty_title()}
      description={m.parts_empty_body()}
    >
      {#snippet actions()}
        <Button onclick={() => (createOpen = true)}>
          <PlusIcon />{m.parts_create()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <section class="flex flex-col gap-3" aria-label={m.parts_filters()}>
      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="relative flex-1">
          <SearchIcon
            class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            class="h-10 ps-9"
            placeholder={m.parts_search_placeholder()}
            aria-label={m.parts_search()}
            autocomplete="off"
            bind:value={q}
          />
        </div>
        <Button
          variant="outline"
          size="lg"
          aria-pressed={lowOnly}
          class={cn(
            lowOnly &&
              "border-warning/50 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning",
          )}
          onclick={() => (lowOnly = !lowOnly)}
        >
          <TriangleAlertIcon />{m.parts_low_only()}
          {#if lowCount > 0}
            <span class="tabular-nums">({lowCount})</span>
          {/if}
        </Button>
      </div>
      {#if hasArchived}
        <SwitchField
          id="parts-archived"
          bind:checked={showArchived}
          label={m.parts_show_archived()}
        />
      {/if}
      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <p aria-live="polite">
          {m.parts_count({ shown: visible.length, total: active.length })}
        </p>
        {#if filtered}
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            onclick={reset}
          >
            {m.parts_filter_reset()}
          </Button>
        {/if}
      </div>
    </section>

    {#if visible.length === 0}
      <EmptyState
        icon={SearchXIcon}
        title={m.parts_no_results_title()}
        description={m.parts_no_results_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}>
            {m.parts_filter_reset()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="bg-card shadow-card divide-y rounded-xl border">
        {#each visible as part (part.id)}
          <PartRow {part} />
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<PartFormDialog
  bind:open={createOpen}
  currency={data.currency}
  onsaved={(part) => goto(partHref(part.id), { invalidateAll: true })}
/>
