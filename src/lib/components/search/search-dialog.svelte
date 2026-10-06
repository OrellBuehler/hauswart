<script lang="ts">
  import CornerDownLeftIcon from "@lucide/svelte/icons/corner-down-left";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import * as Command from "$lib/components/ui/command/index.js";
  import { searchHref } from "$lib/docs/links";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import {
    groupHits,
    hitIcons,
    hitLabels,
    safeHitUrl,
    type SearchHit,
  } from "$lib/search/types";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const DELAY_MS = 200;
  const LIMIT = 30;

  let q = $state("");
  let hits = $state.raw<SearchHit[]>([]);
  let phase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let error = $state<string | undefined>();
  let run = 0;

  const term = $derived(q.trim().slice(0, 100));
  const groups = $derived(groupHits(hits));

  $effect(() => {
    if (!open) {
      run += 1;
      q = "";
      hits = [];
      phase = "idle";
      error = undefined;
      return;
    }
    const current = term;
    if (!current) {
      run += 1;
      hits = [];
      phase = "idle";
      return;
    }
    phase = "loading";
    const timer = setTimeout(async () => {
      const id = ++run;
      try {
        const result = await api.call(endpoints.search, {
          query: { q: current, limit: LIMIT },
        });
        if (id !== run) return;
        hits = result.items;
        error = undefined;
        phase = "ready";
      } catch (err) {
        if (id !== run) return;
        error = apiErrorMessage(err);
        phase = "error";
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  });

  function close() {
    open = false;
  }
</script>

<Command.Dialog
  bind:open
  shouldFilter={false}
  loop
  title={m.search_title()}
  description={m.search_description()}
>
  <div class="relative">
    <Command.Input
      bind:value={q}
      placeholder={m.search_placeholder()}
      aria-label={m.search_placeholder()}
      maxlength={100}
      autocomplete="off"
    />
    {#if phase === "loading"}
      <LoaderCircleIcon
        class="text-muted-foreground absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin"
        aria-label={m.common_loading()}
      />
    {/if}
  </div>
  <Command.List>
    {#if phase === "idle"}
      <div
        class="text-muted-foreground flex flex-col items-center gap-2 px-6 py-8 text-center text-sm"
      >
        <SearchIcon class="size-5 opacity-60" aria-hidden="true" />
        <p class="text-pretty">{m.search_idle()}</p>
      </div>
    {:else if phase === "error"}
      <div class="p-3"><FormAlert message={error} /></div>
    {:else if phase === "ready" && hits.length === 0}
      <p
        class="text-muted-foreground px-6 py-8 text-center text-sm text-pretty"
        role="status"
      >
        {m.search_empty({ q: term })}
      </p>
    {/if}

    {#each groups as group (group.type)}
      {@const Icon = hitIcons[group.type]}
      <Command.Group heading={hitLabels[group.type]()}>
        {#each group.items as hit (`${hit.type}:${hit.id}`)}
          {@const href = safeHitUrl(hit.url)}
          {#if href}
            <Command.LinkItem
              value={`${hit.type}:${hit.id}`}
              {href}
              onSelect={close}
              class="items-start"
            >
              <Icon class="text-muted-foreground mt-0.5" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{hit.title}</span>
                {#if hit.snippet}
                  <span class="text-muted-foreground line-clamp-1 text-xs"
                    >{hit.snippet}</span
                  >
                {/if}
              </span>
            </Command.LinkItem>
          {/if}
        {/each}
      </Command.Group>
    {/each}

    {#if hits.length > 0}
      <Command.Separator />
      <Command.Group>
        <Command.LinkItem
          value="__all"
          href={searchHref(term)}
          onSelect={close}
          forceMount
        >
          <SearchIcon aria-hidden="true" />
          <span class="flex-1">{m.search_all_results({ q: term })}</span>
        </Command.LinkItem>
      </Command.Group>
    {/if}
  </Command.List>
  <div
    class="text-muted-foreground flex items-center justify-end gap-3 border-t px-3 py-2 text-xs max-sm:hidden"
    aria-hidden="true"
  >
    <span class="flex items-center gap-1">
      <kbd class="bg-muted rounded border px-1 font-sans">↑</kbd>
      <kbd class="bg-muted rounded border px-1 font-sans">↓</kbd>
      {m.search_hint_navigate()}
    </span>
    <span class="flex items-center gap-1">
      <kbd class="bg-muted rounded border px-1 font-sans"
        ><CornerDownLeftIcon class="size-3" /></kbd
      >
      {m.search_hint_open()}
    </span>
    <span class="flex items-center gap-1">
      <kbd class="bg-muted rounded border px-1 font-sans">Esc</kbd>
      {m.search_hint_close()}
    </span>
  </div>
</Command.Dialog>
