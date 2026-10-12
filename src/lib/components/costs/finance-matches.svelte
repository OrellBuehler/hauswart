<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LandmarkIcon from "@lucide/svelte/icons/landmark";
  import { untrack } from "svelte";
  import { api } from "$lib/api/browser";
  import { isApiError } from "$lib/api/errors";
  import { endpoints } from "$lib/api/registry";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    MATCH_DEBOUNCE_MS,
    chosenId,
    fittingMatches,
    matchKey,
    matchTitle,
    matchWhen,
    type FinanceMatch,
    type MatchQuery,
  } from "$lib/costs/matches";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import CostAmount from "./cost-amount.svelte";

  /** How long the note that a choice was released stays. */
  const RELEASED_NOTE_MS = 8000;

  let {
    id,
    query,
    value = $bindable(""),
    disabled = false,
    error,
    refresh = 0,
    class: className,
  }: {
    id: string;
    /**
     * The entry as typed (see `matchQuery`), or `null` while it is not known well enough, or when the person has no
     * finance connection: nothing is asked then.
     */
    query: MatchQuery | null;
    /** The id of the chosen bank transaction; empty for none. */
    value?: string;
    disabled?: boolean;
    /** Why the server refused the choice. */
    error?: string | undefined;
    /** Counts up when the parent wants the list asked for again (a choice was refused). */
    refresh?: number;
    class?: string;
  } = $props();

  let matches = $state.raw<FinanceMatch[]>([]);
  let failed = $state(false);
  let retry = $state(0);
  let released = $state(false);

  const key = $derived(matchKey(query));
  const fitting = $derived(fittingMatches(matches, query));

  // Ask for the matches shortly after the amount, currency or date stopped changing; an answer to an older question is
  // dropped.
  $effect(() => {
    void [key, refresh, retry];
    const asked = untrack(() => query);
    if (!asked) {
      matches = [];
      failed = false;
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.call(endpoints.financeMatches, {
          query: asked,
        });
        if (!current) return;
        matches = result.items;
        failed = false;
      } catch (err) {
        if (!current) return;
        console.warn(
          "finance matches unavailable",
          isApiError(err) ? err.code : "network",
        );
        matches = [];
        failed = true;
      }
    }, MATCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });

  // A choice that does not fit the entry any more (the amount or date moved) is released at once: it would be refused.
  $effect(() => {
    const keep = chosenId(value, matches, query);
    untrack(() => {
      if (value !== "" && keep === "") {
        value = "";
        released = true;
      }
    });
  });

  $effect(() => {
    if (!released) return;
    const timer = setTimeout(() => (released = false), RELEASED_NOTE_MS);
    return () => clearTimeout(timer);
  });

  function choose(match: FinanceMatch) {
    released = false;
    value = value === match.id ? "" : match.id;
  }
</script>

{#if query && (fitting.length > 0 || failed)}
  <section
    {id}
    aria-labelledby={`${id}-title`}
    class={cn(
      "bg-card flex min-w-0 flex-col gap-3 rounded-xl border p-3 sm:p-4",
      className,
    )}
  >
    {#if failed}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-muted-foreground text-sm text-pretty">
          {m.match_error_load()}
        </p>
        <Button
          variant="outline"
          size="sm"
          {disabled}
          onclick={() => (retry += 1)}
        >
          {m.common_retry()}
        </Button>
      </div>
      <h3 id={`${id}-title`} class="sr-only">{m.match_title()}</h3>
    {:else}
      <div class="flex min-w-0 flex-col gap-1">
        <h3
          id={`${id}-title`}
          class="flex items-center gap-2 text-sm leading-tight font-semibold"
        >
          <LandmarkIcon
            class="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          {m.match_title()}
        </h3>
        <p class="text-muted-foreground text-xs text-pretty" aria-live="polite">
          {m.match_description({ count: fitting.length })}
        </p>
      </div>
      <ul class="flex flex-col gap-2">
        {#each fitting as match (match.id)}
          {@const on = value === match.id}
          <li>
            <button
              type="button"
              aria-pressed={on}
              aria-label={m.match_choose({ title: matchTitle(match) })}
              {disabled}
              class={cn(
                "focus-visible:ring-ring/50 flex w-full min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-12",
                on
                  ? "border-brand bg-brand/10"
                  : "bg-background hover:bg-accent/50",
              )}
              onclick={() => choose(match)}
            >
              <span class="min-w-0 flex-1">
                <span
                  class="block text-sm font-medium text-pretty wrap-anywhere"
                  >{matchTitle(match)}</span
                >
                <span
                  class="text-muted-foreground mt-0.5 block text-xs wrap-anywhere"
                  >{m.match_booked({
                    date: formatDay(match.payload.date),
                    when: matchWhen(match, query),
                  })}</span
                >
                {#if on}
                  <span
                    class="text-brand mt-1 flex items-center gap-1 text-xs font-medium"
                  >
                    <CheckIcon class="size-3.5" aria-hidden="true" />
                    {m.match_chosen()}
                  </span>
                {/if}
              </span>
              <CostAmount
                amountMinor={match.payload.amountMinor}
                currency={match.payload.currency}
                class="shrink-0 text-sm font-medium"
              />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}
      <p class="text-destructive text-xs text-pretty">{error}</p>
    {/if}
  </section>
{/if}
{#if released && value === ""}
  <p class="text-muted-foreground text-xs text-pretty" aria-live="polite">
    {m.match_reset()}
  </p>
{/if}
{#if error && !(query && (fitting.length > 0 || failed))}
  <p class="text-destructive text-xs text-pretty">{error}</p>
{/if}
