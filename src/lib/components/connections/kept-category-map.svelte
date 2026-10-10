<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import {
    categoryRows,
    readCategoryCount,
    withAutoAccept,
    withCostCategory,
    withPurchase,
    type KeptCategory,
    type KeptSettings,
  } from "$lib/connections/kept";
  import { categoryLabels } from "$lib/costs/labels";
  import { m } from "$lib/paraglide/messages";

  let {
    settings = $bindable(),
    categories,
    loading,
    error,
    paused,
    onretry,
  }: {
    settings: KeptSettings;
    /** The list from Kept; undefined while it is not there (loading, failed, paused). */
    categories: KeptCategory[] | undefined;
    loading: boolean;
    error: string | undefined;
    paused: boolean;
    onretry: () => void;
  } = $props();

  const NONE = "none";

  const options = $derived([
    { value: NONE, label: m.integration_kept_category_none() },
    ...COST_CATEGORIES.map((category) => ({
      value: category,
      label: categoryLabels[category](),
    })),
  ]);

  const rows = $derived(categoryRows(categories ?? [], settings));
  let q = $state("");
  const query = $derived(q.trim().toLowerCase());
  const shown = $derived(
    query
      ? rows.filter((row) =>
          `${row.parents} ${row.name} ${row.id}`.toLowerCase().includes(query),
        )
      : rows,
  );
  const count = $derived(readCategoryCount(settings));
</script>

<div class="flex flex-col gap-3">
  {#if paused}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.integration_kept_categories_paused()}
    </p>
  {:else if loading && categories === undefined}
    <div
      class="flex flex-col gap-2"
      role="status"
      aria-label={m.integration_kept_categories_loading()}
    >
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-10 w-full" />
      <Skeleton class="h-10 w-full" />
    </div>
  {:else if error}
    <Alert.Root variant="destructive" class="border-destructive/40">
      <CircleAlertIcon />
      <Alert.Description class="flex flex-col items-start gap-2">
        <span class="text-pretty">{error}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="text-foreground h-9"
          disabled={loading}
          onclick={onretry}
        >
          {#if loading}
            <LoaderCircleIcon class="animate-spin" />
          {/if}
          {m.common_retry()}
        </Button>
      </Alert.Description>
    </Alert.Root>
  {:else if categories !== undefined && categories.length === 0 && rows.length === 0}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.integration_kept_categories_empty()}
    </p>
  {/if}

  {#if rows.length > 0}
    <p class="text-muted-foreground text-xs" aria-live="polite">
      {m.integration_kept_categories_summary({ count })}
    </p>
    {#if rows.length > 8}
      <div class="relative">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          class="h-10 ps-9"
          placeholder={m.integration_kept_categories_search()}
          aria-label={m.integration_kept_categories_search()}
          autocomplete="off"
          bind:value={q}
          onkeydown={(event) => {
            // Enter in the search box must not submit the settings.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </div>
    {/if}
    <div
      role="group"
      aria-label={m.integration_kept_categories_aria()}
      class="overflow-x-auto rounded-lg border"
    >
      <div class="lg:min-w-[34rem]">
        <div
          class="bg-muted/40 text-muted-foreground hidden gap-3 border-b px-3 py-2 text-xs font-medium lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_5.5rem_4.5rem]"
          aria-hidden="true"
        >
          <span>{m.integration_kept_col_kept()}</span>
          <span>{m.integration_kept_col_category()}</span>
          <span class="text-center">{m.integration_kept_col_auto()}</span>
          <span class="text-center">{m.integration_kept_col_device()}</span>
        </div>
        {#if shown.length === 0}
          <p class="text-muted-foreground px-3 py-6 text-center text-sm">
            {m.picker_no_match()}
          </p>
        {:else}
          <ul class="divide-y">
            {#each shown as row, index (row.id)}
              {@const mapped = settings.categoryMap[row.id]}
              {@const selectId = `kept-cat-${index}`}
              <li
                class="flex flex-col gap-2 px-3 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_5.5rem_4.5rem] lg:items-center lg:gap-3 lg:py-2"
              >
                <div class="flex min-w-0 flex-col gap-0.5">
                  {#if row.parents}
                    <span class="text-muted-foreground truncate text-xs"
                      >{row.parents}</span
                    >
                  {/if}
                  <span
                    class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <span
                      class={row.known
                        ? "min-w-0 text-sm font-medium break-words"
                        : "min-w-0 font-mono text-xs break-all"}
                    >
                      {row.name}
                    </span>
                    {#if row.income}
                      <Badge variant="outline" class="text-muted-foreground">
                        {m.integration_kept_category_income()}
                      </Badge>
                    {/if}
                    {#if !row.known && categories !== undefined}
                      <Badge
                        variant="outline"
                        class="border-warning/50 text-warning"
                      >
                        {m.integration_kept_category_unknown()}
                      </Badge>
                    {/if}
                  </span>
                </div>
                <div class="min-w-0">
                  <Label for={selectId} class="sr-only">
                    {m.integration_kept_category_select_aria({
                      name: row.name,
                    })}
                  </Label>
                  <OptionSelect
                    id={selectId}
                    value={mapped ?? NONE}
                    {options}
                    onchange={(next) =>
                      (settings = withCostCategory(
                        settings,
                        row.id,
                        next === NONE ? null : (next as CostCategory),
                      ))}
                  />
                </div>
                <div class="flex flex-wrap gap-x-5 lg:contents">
                  <label
                    class="flex min-h-10 items-center gap-2 lg:justify-center"
                  >
                    <Checkbox
                      checked={settings.autoAcceptCategoryIds.includes(row.id)}
                      disabled={mapped === undefined}
                      onCheckedChange={(on) =>
                        (settings = withAutoAccept(settings, row.id, on))}
                      aria-label={m.integration_kept_auto_aria({
                        name: row.name,
                      })}
                    />
                    <span class="text-sm lg:sr-only">
                      {m.integration_kept_col_auto()}
                    </span>
                  </label>
                  <label
                    class="flex min-h-10 items-center gap-2 lg:justify-center"
                  >
                    <Checkbox
                      checked={settings.purchaseCategoryIds.includes(row.id)}
                      onCheckedChange={(on) =>
                        (settings = withPurchase(settings, row.id, on))}
                      aria-label={m.integration_kept_device_aria({
                        name: row.name,
                      })}
                    />
                    <span class="text-sm lg:sr-only">
                      {m.integration_kept_col_device()}
                    </span>
                  </label>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>
