<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import QuickEntry from "$lib/components/costs/quick-entry.svelte";
  import QuickReceipt from "$lib/components/costs/quick-receipt.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { parseQuickMode, type QuickMode } from "$lib/costs/quick";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));

  // `?mode=receipt` (the home screen shortcut) opens on the receipt; a mode chosen here holds until the address changes.
  const urlMode = $derived(parseQuickMode(page.url.searchParams.get("mode")));
  let chosen = $state<QuickMode | null>(null);
  const mode = $derived(chosen ?? urlMode);
  $effect(() => {
    void urlMode;
    chosen = null;
  });

  const requestedBook = $derived(page.url.searchParams.get("book"));

  const modeOptions = $derived([
    { value: "expense" as const, label: m.quick_mode_expense() },
    { value: "receipt" as const, label: m.quick_mode_receipt() },
  ]);
</script>

<svelte:head>
  <title>{m.quick_title()} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-xl flex-col gap-5">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.cost_back()}
    </a>
  </div>

  <header class="min-w-0">
    <h1
      class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
    >
      {m.quick_title()}
    </h1>
    <p class="text-muted-foreground mt-1 text-sm text-pretty max-md:hidden">
      {m.quick_description()}
    </p>
  </header>

  {#if !canWrite}
    <EmptyState
      icon={LockKeyholeIcon}
      title={m.quick_forbidden_title()}
      description={m.quick_forbidden_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/costs")}>{m.cost_back()}</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <Segmented
      options={modeOptions}
      value={mode}
      label={m.quick_mode_label()}
      onchange={(next) => (chosen = next)}
    />

    <!-- Both stay mounted so that switching back does not lose what was typed. -->
    <div hidden={mode !== "expense"}>
      <QuickEntry
        books={data.books}
        people={data.people}
        assets={data.assets}
        currency={data.currency}
        today={data.today}
        currentUserId={data.user.id}
        history={data.history}
        {requestedBook}
      />
    </div>
    <div hidden={mode !== "receipt"}>
      <QuickReceipt books={data.books} assets={data.assets} />
    </div>
  {/if}
</div>
