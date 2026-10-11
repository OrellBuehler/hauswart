<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import InfoIcon from "@lucide/svelte/icons/info";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { api } from "$lib/api/browser";
  import type { CalendarProviderKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import {
    capabilityLabels,
    capabilityLevel,
    capabilityNotes,
  } from "$lib/calendar-sync/labels";
  import { providerName } from "$lib/calendar-sync/providers";
  import type { ExternalCalendar } from "$lib/connections/types";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    provider,
    value = $bindable(""),
    chosen = $bindable(),
    usedIds = [],
    invalid = false,
    describedby,
  }: {
    id: string;
    provider: CalendarProviderKind;
    /** The id of the chosen calendar. */
    value?: string;
    /** The chosen calendar as the system listed it (its name and what it allows). */
    chosen?: ExternalCalendar | undefined;
    /** Calendars of this system that already have a target: they cannot be chosen again. */
    usedIds?: readonly string[];
    invalid?: boolean;
    describedby?: string | undefined;
  } = $props();

  let phase = $state<"loading" | "ready" | "error">("loading");
  let calendars = $state.raw<ExternalCalendar[]>([]);
  let error = $state<string | undefined>();
  let q = $state("");
  let run = 0;

  async function load() {
    const current = ++run;
    phase = "loading";
    error = undefined;
    try {
      const { items } = await api.call(endpoints.integrationsCalendars, {
        params: { kind: provider },
      });
      if (current !== run) return;
      calendars = items;
      phase = "ready";
    } catch (err) {
      if (current !== run) return;
      error = pickerErrorMessage(err, provider);
      phase = "error";
    }
  }

  $effect(() => {
    void provider;
    void load();
    return () => {
      run += 1;
    };
  });

  const query = $derived(q.trim().toLowerCase());
  const shown = $derived(
    query
      ? calendars.filter((c) =>
          `${c.name} ${c.id}`.toLowerCase().includes(query),
        )
      : calendars,
  );
  const note = $derived(
    chosen ? capabilityNotes[capabilityLevel(chosen.capabilities)] : null,
  );

  function reason(calendar: ExternalCalendar): string | null {
    if (calendar.capabilities && !calendar.capabilities.create) {
      return m.caltargets_caps_none();
    }
    if (usedIds.includes(calendar.id)) return m.caltargets_calendar_taken();
    return null;
  }

  function pick(calendar: ExternalCalendar) {
    if (reason(calendar) !== null) return;
    value = calendar.id;
    chosen = calendar;
  }
</script>

<div class="flex min-w-0 flex-col gap-2">
  {#if phase === "loading"}
    <div
      class="flex flex-col gap-2"
      role="status"
      aria-label={m.caltargets_calendar_loading()}
    >
      <Skeleton class="h-14 w-full rounded-lg" />
      <Skeleton class="h-14 w-full rounded-lg" />
    </div>
  {:else if phase === "error"}
    <div class="flex flex-col items-start gap-3">
      <FormAlert message={error} />
      <Button type="button" variant="outline" onclick={() => load()}>
        {m.common_retry()}
      </Button>
    </div>
  {:else if calendars.length === 0}
    <p
      class="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm text-pretty"
    >
      {m.caltargets_calendar_empty({ provider: providerName(provider) })}
    </p>
  {:else}
    {#if calendars.length > 6}
      <div class="relative">
        <SearchIcon
          class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          class="h-10 ps-9"
          placeholder={m.picker_search()}
          aria-label={m.picker_search()}
          autocomplete="off"
          bind:value={q}
        />
      </div>
    {/if}
    <div
      {id}
      role="radiogroup"
      aria-label={m.caltargets_calendar()}
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
      class={cn(
        "max-h-[min(16rem,40dvh)] overflow-y-auto rounded-lg border",
        invalid && "border-destructive",
      )}
    >
      {#if shown.length === 0}
        <p class="text-muted-foreground px-3 py-6 text-center text-sm">
          {m.picker_no_match()}
        </p>
      {:else}
        <ul class="divide-y">
          {#each shown as calendar (calendar.id)}
            {@const selected = calendar.id === value}
            {@const blocked = reason(calendar)}
            {@const level = capabilityLevel(calendar.capabilities)}
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={blocked !== null}
                class={cn(
                  "hover:bg-accent/50 focus-visible:ring-ring/50 flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-start transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                  selected && "bg-accent",
                )}
                onclick={() => pick(calendar)}
              >
                <span class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="text-sm font-medium wrap-anywhere"
                    >{calendar.name}</span
                  >
                  <span
                    class="text-muted-foreground font-mono text-xs break-all"
                    >{calendar.id}</span
                  >
                  <span class="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{capabilityLabels[level]()}</Badge>
                    {#if blocked}
                      <span class="text-destructive text-xs">{blocked}</span>
                    {/if}
                  </span>
                </span>
                {#if selected}
                  <CheckIcon
                    class="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if note}
      <p
        class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-pretty"
      >
        <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{note()}</span>
      </p>
    {/if}
  {/if}
</div>
