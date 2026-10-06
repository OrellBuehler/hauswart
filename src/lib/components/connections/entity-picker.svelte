<script lang="ts">
  import { resolve } from "$app/paths";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type {
    ExternalCalendar,
    ExternalEntity,
  } from "$lib/connections/types";
  import * as Command from "$lib/components/ui/command/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import {
    homeAssistantOf,
    isUsable,
    loadIntegrations,
  } from "$lib/connections/connection";
  import {
    ENTITY_ID_PATTERN,
    formatReading,
    searchEntities,
  } from "$lib/connections/entities";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import EntityReading from "./entity-reading.svelte";

  let {
    id,
    value = $bindable(""),
    source = "entities",
    domain,
    placeholder,
    invalid = false,
    describedby,
    showReading = true,
    onresolve,
    onpick,
  }: {
    id: string;
    /** The entity id (`sensor.example_washer_cycles`) or calendar id (`calendar.example_waste`). */
    value?: string | undefined;
    source?: "entities" | "calendars";
    /** Only entities of this domain (`sensor`, `binary_sensor`, ...). */
    domain?: string;
    placeholder: string;
    invalid?: boolean;
    describedby?: string | undefined;
    /** The current value of the chosen entity below the field. */
    showReading?: boolean;
    onresolve?: (entity: ExternalEntity | null | undefined) => void;
    /** The person chose an entry from the list (not on load): the entity, or null for a typed id. */
    onpick?: (entity: ExternalEntity | null) => void;
  } = $props();

  /** `null` while the connection is still being looked up. */
  let connected = $state<boolean | null>(null);
  let broken = $state(false);

  let open = $state(false);
  let search = $state("");
  let entities = $state<ExternalEntity[]>([]);
  let total = $state(0);
  let calendars = $state<ExternalCalendar[]>([]);
  let loading = $state(false);
  let error = $state<string | undefined>();
  let sequence = 0;

  $effect(() => {
    let cancelled = false;
    loadIntegrations().then(
      (list) => {
        if (cancelled) return;
        const ha = homeAssistantOf(list);
        connected = isUsable(ha);
        broken = connected && ha?.status === "error";
      },
      (err) => {
        console.warn("integrations unavailable", err);
        if (!cancelled) connected = false;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  async function loadCalendars() {
    loading = true;
    error = undefined;
    try {
      calendars = (
        await api.call(endpoints.integrationsCalendars, {
          params: { kind: "homeassistant" },
        })
      ).items;
    } catch (err) {
      error = pickerErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (connected && source === "calendars") void loadCalendars();
  });

  $effect(() => {
    if (!open || source !== "entities") return;
    const q = search;
    const ticket = ++sequence;
    loading = true;
    const handle = setTimeout(
      async () => {
        try {
          const result = await searchEntities(q, domain);
          if (ticket !== sequence) return;
          entities = result.items;
          total = result.total;
          error = undefined;
        } catch (err) {
          if (ticket !== sequence) return;
          error = pickerErrorMessage(err);
        } finally {
          if (ticket === sequence) loading = false;
        }
      },
      q === "" ? 0 : 250,
    );
    return () => clearTimeout(handle);
  });

  $effect(() => {
    if (open) {
      search = "";
      error = undefined;
      if (source === "calendars") void loadCalendars();
    }
  });

  const query = $derived(search.trim().toLowerCase());
  const shownCalendars = $derived(
    query
      ? calendars.filter(
          (c) =>
            c.id.toLowerCase().includes(query) ||
            c.name.toLowerCase().includes(query),
        )
      : calendars,
  );
  const typed = $derived(search.trim());
  const canUseTyped = $derived(
    ENTITY_ID_PATTERN.test(typed) &&
      !(source === "entities" ? entities : calendars).some(
        (item) => item.id === typed,
      ),
  );
  const chosenCalendar = $derived(calendars.find((c) => c.id === value));

  function pick(next: string, entity: ExternalEntity | null = null) {
    value = next;
    open = false;
    onpick?.(entity);
  }
</script>

{#if connected}
  <div class="flex min-w-0 flex-col gap-1.5">
    <Popover.Root bind:open>
      <Popover.Trigger
        {id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class={cn(
          "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-start text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] md:text-sm",
          invalid &&
            "border-destructive ring-destructive/20 dark:ring-destructive/40",
        )}
      >
        {#if value}
          <span class="flex min-w-0 flex-col leading-tight">
            {#if source === "calendars" && chosenCalendar}
              <span class="truncate">{chosenCalendar.name}</span>
              <span class="text-muted-foreground truncate font-mono text-[11px]"
                >{value}</span
              >
            {:else}
              <span class="truncate font-mono text-sm">{value}</span>
            {/if}
          </span>
        {:else}
          <span class="text-muted-foreground truncate">{placeholder}</span>
        {/if}
        <ChevronsUpDownIcon
          class="size-4 shrink-0 opacity-50"
          aria-hidden="true"
        />
      </Popover.Trigger>
      <Popover.Content
        align="start"
        class="w-(--bits-popover-anchor-width) min-w-[min(20rem,calc(100vw-2rem))] p-0"
      >
        <Command.Root shouldFilter={false} class="rounded-md">
          <Command.Input
            bind:value={search}
            placeholder={source === "calendars"
              ? m.entity_picker_search_calendars()
              : m.entity_picker_search()}
            aria-label={source === "calendars"
              ? m.entity_picker_search_calendars()
              : m.entity_picker_search()}
            autocapitalize="none"
            autocomplete="off"
            spellcheck={false}
          />
          <Command.List>
            {#if error}
              <div
                class="text-destructive flex items-start gap-2 px-3 py-3 text-sm text-pretty"
                role="alert"
              >
                <TriangleAlertIcon
                  class="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error} {m.entity_picker_error_manual()}</span>
              </div>
            {:else if source === "entities"}
              {#if loading && entities.length === 0}
                <p
                  class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm"
                >
                  <LoaderCircleIcon
                    class="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  {m.entity_picker_loading()}
                </p>
              {:else if entities.length === 0 && !canUseTyped}
                <p class="text-muted-foreground py-6 text-center text-sm">
                  {m.entity_picker_empty()}
                </p>
              {:else}
                <Command.Group>
                  {#each entities as entity (entity.id)}
                    <Command.Item
                      value={entity.id}
                      class="items-start"
                      onSelect={() => pick(entity.id, entity)}
                    >
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate font-medium">{entity.name}</span>
                        <span
                          class="text-muted-foreground truncate font-mono text-[11px]"
                        >
                          {entity.id}{entity.area ? ` · ${entity.area}` : ""}
                        </span>
                      </span>
                      <span
                        class="text-muted-foreground max-w-[40%] shrink-0 truncate pt-0.5 text-xs tabular-nums"
                      >
                        {formatReading(entity)}
                      </span>
                    </Command.Item>
                  {/each}
                </Command.Group>
                {#if total > entities.length}
                  <p class="text-muted-foreground border-t px-3 py-2 text-xs">
                    {m.entity_picker_more({ shown: entities.length, total })}
                  </p>
                {/if}
              {/if}
            {:else if loading && calendars.length === 0}
              <p
                class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm"
              >
                <LoaderCircleIcon
                  class="size-4 animate-spin"
                  aria-hidden="true"
                />
                {m.entity_picker_loading()}
              </p>
            {:else if shownCalendars.length === 0 && !canUseTyped}
              <p class="text-muted-foreground py-6 text-center text-sm">
                {calendars.length === 0
                  ? m.entity_picker_no_calendars()
                  : m.entity_picker_empty()}
              </p>
            {:else}
              <Command.Group>
                {#each shownCalendars as calendar (calendar.id)}
                  <Command.Item
                    value={calendar.id}
                    class="items-start"
                    onSelect={() => pick(calendar.id)}
                  >
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate font-medium">{calendar.name}</span>
                      <span
                        class="text-muted-foreground truncate font-mono text-[11px]"
                        >{calendar.id}</span
                      >
                    </span>
                  </Command.Item>
                {/each}
              </Command.Group>
            {/if}
            {#if canUseTyped}
              <Command.Group>
                <Command.Item
                  value={`__typed ${typed}`}
                  forceMount
                  onSelect={() => pick(typed)}
                >
                  <PlusIcon aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">
                    {m.entity_picker_use_typed({ id: typed })}
                  </span>
                </Command.Item>
              </Command.Group>
            {/if}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
    {#if broken}
      <p class="text-warning text-xs text-pretty">{m.entity_picker_broken()}</p>
    {/if}
    {#if showReading && source === "entities"}
      <EntityReading entityId={value ?? ""} {onresolve} />
    {/if}
  </div>
{:else}
  <div class="flex min-w-0 flex-col gap-1.5">
    <Input
      {id}
      class="h-10 font-mono"
      autocomplete="off"
      autocapitalize="none"
      spellcheck={false}
      {placeholder}
      bind:value
      aria-invalid={invalid || undefined}
      aria-describedby={describedby}
    />
    {#if connected === false}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.entity_picker_manual()}
        <a
          href={resolve("/settings/integrations")}
          class="text-foreground underline underline-offset-2"
        >
          {m.entity_picker_connect()}
        </a>
      </p>
    {/if}
  </div>
{/if}
