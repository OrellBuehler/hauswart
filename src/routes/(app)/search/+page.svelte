<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { searchHref } from "$lib/docs/links";
  import { m } from "$lib/paraglide/messages";
  import {
    HIT_TYPES,
    groupHits,
    hitIcons,
    hitLabels,
    safeHitUrl,
    type SearchHitType,
  } from "$lib/search/types";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let input = $derived(data.q);

  const typeParam = $derived(page.url.searchParams.get("type"));
  const active = $derived(HIT_TYPES.find((type) => type === typeParam) ?? null);
  const counts = $derived(
    Object.fromEntries(
      HIT_TYPES.map((type) => [
        type,
        data.hits.filter((hit) => hit.type === type).length,
      ]),
    ) as Record<SearchHitType, number>,
  );
  const visible = $derived(
    active ? data.hits.filter((hit) => hit.type === active) : data.hits,
  );
  const groups = $derived(groupHits(visible));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const q = input.trim();
    if (q) void goto(searchHref(q));
  }
</script>

<svelte:head>
  <title>
    {data.q ? m.search_page_title_q({ q: data.q }) : m.search_page_title()} · {m.app_name()}
  </title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.search_page_title()} />

  <form class="flex gap-2" role="search" onsubmit={submit}>
    <div class="relative flex-1">
      <SearchIcon
        class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        class="h-10 ps-9"
        placeholder={m.search_placeholder()}
        aria-label={m.search_placeholder()}
        autocomplete="off"
        enterkeyhint="search"
        maxlength={100}
        bind:value={input}
      />
    </div>
    <Button type="submit" size="lg">{m.search_submit()}</Button>
  </form>

  {#if !data.q}
    <EmptyState
      icon={SearchIcon}
      title={m.search_page_idle_title()}
      description={m.search_idle()}
    />
  {:else if data.hits.length === 0}
    <EmptyState
      icon={SearchXIcon}
      title={m.search_page_empty_title()}
      description={m.search_empty({ q: data.q })}
    />
  {:else}
    <div class="flex flex-col gap-3">
      <nav
        aria-label={m.search_filter_type()}
        class="-mx-4 overflow-x-auto px-4 max-md:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)] md:mx-0 md:px-0"
      >
        <ul class="flex w-max gap-2 md:w-auto md:flex-wrap">
          {#each [null, ...HIT_TYPES.filter((type) => counts[type] > 0)] as type (type ?? "all")}
            {@const selected = active === type}
            <li>
              <a
                href={searchHref(data.q, type)}
                aria-current={selected ? "true" : undefined}
                class={cn(
                  "focus-visible:ring-ring/50 inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px]",
                  selected
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-accent",
                )}
              >
                {type ? hitLabels[type]() : m.search_filter_all()}
                <span class="text-xs tabular-nums opacity-70">
                  {type ? counts[type] : data.hits.length}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </nav>
      <p class="text-muted-foreground text-xs" aria-live="polite">
        {m.search_result_count({ count: visible.length, q: data.q })}
      </p>
    </div>

    <div class="flex flex-col gap-6">
      {#each groups as group (group.type)}
        {@const Icon = hitIcons[group.type]}
        <section
          class="flex flex-col gap-2"
          aria-labelledby={`search-group-${group.type}`}
        >
          <h2
            id={`search-group-${group.type}`}
            class="text-muted-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <Icon class="size-4" aria-hidden="true" />{hitLabels[group.type]()}
          </h2>
          <ul class="divide-y rounded-lg border">
            {#each group.items as hit (`${hit.type}:${hit.id}`)}
              {@const href = safeHitUrl(hit.url)}
              <li>
                {#if href}
                  <a
                    href={resolve(href as "/")}
                    class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-0.5 px-4 py-3 outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px]"
                  >
                    <span class="line-clamp-2 text-sm font-medium break-words"
                      >{hit.title}</span
                    >
                    {#if hit.snippet}
                      <span
                        class="text-muted-foreground line-clamp-2 text-xs text-pretty"
                      >
                        {hit.snippet}
                      </span>
                    {/if}
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>
