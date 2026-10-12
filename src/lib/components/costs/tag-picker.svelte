<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { tick } from "svelte";
  import { resolve } from "$app/paths";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import {
    COST_TAG_NAME_MAX,
    MAX_COST_TAGS,
    MAX_TAGS_PER_COST,
    type CostTag,
  } from "$lib/api/schemas/cost-tags";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    TAG_COLOR_STYLES,
    canAddTag,
    nextTagColor,
    sortTags,
    tagNameProblem,
    tagSaveMessage,
    toggleTagId,
  } from "$lib/costs/tags";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  /** From this many tags on, the chips can be narrowed by typing. */
  const FILTER_FROM = 12;

  let {
    id,
    tags,
    value = $bindable([]),
    max = MAX_TAGS_PER_COST,
    creatable = false,
    disabled = false,
    error,
    oncreated,
    class: className,
  }: {
    id: string;
    /** Every tag of the household. */
    tags: readonly CostTag[];
    /** The ids of the chosen tags. */
    value?: string[];
    max?: number;
    /** Offers a new tag by name, made on the spot (needs the right to book costs, like the forms this sits in). */
    creatable?: boolean;
    disabled?: boolean;
    error?: string | undefined;
    /** A tag was made here: the page may add it to its own list. */
    oncreated?: (tag: CostTag) => void;
    class?: string;
  } = $props();

  let created = $state.raw<CostTag[]>([]);
  let query = $state("");
  let adding = $state(false);
  let newName = $state("");
  let creating = $state(false);
  let createError = $state<string | undefined>();
  let nameEl = $state<HTMLInputElement | null>(null);

  const all = $derived(
    sortTags([
      ...tags,
      ...created.filter((tag) => !tags.some((known) => known.id === tag.id)),
    ]),
  );
  const full = $derived(!canAddTag(value, max));
  const filtering = $derived(all.length >= FILTER_FROM);
  const shown = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!filtering || needle === "") return all;
    return all.filter(
      (tag) =>
        value.includes(tag.id) || tag.name.toLocaleLowerCase().includes(needle),
    );
  });
  const describedby = $derived(
    [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" "),
  );

  async function startAdding() {
    adding = true;
    createError = undefined;
    await tick();
    nameEl?.focus();
  }

  function stopAdding() {
    adding = false;
    newName = "";
    createError = undefined;
  }

  async function create() {
    if (creating) return;
    const problem = tagNameProblem(newName, all);
    if (problem) {
      createError = problem;
      return;
    }
    if (all.length >= MAX_COST_TAGS) {
      createError = m.costtag_error_limit({ max: MAX_COST_TAGS });
      return;
    }
    creating = true;
    createError = undefined;
    try {
      const tag = await api.call(endpoints.costTagsCreate, {
        body: { name: newName.trim(), color: nextTagColor(all) },
      });
      created = [...created, tag];
      if (canAddTag(value, max)) value = [...value, tag.id];
      oncreated?.(tag);
      stopAdding();
    } catch (err) {
      createError = tagSaveMessage(err, all, true) ?? apiErrorMessage(err);
    } finally {
      creating = false;
    }
  }

  function onNameKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      // The picker sits in a form that must not be sent from here.
      event.preventDefault();
      void create();
    } else if (event.key === "Escape" && adding) {
      event.stopPropagation();
      stopAdding();
    }
  }
</script>

<div class={cn("flex min-w-0 flex-col gap-2", className)}>
  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
    <span id={`${id}-label`} class="text-sm leading-none font-medium"
      >{m.costtag_picker_label()}
      <span class="text-muted-foreground font-normal"
        >({m.common_optional()})</span
      ></span
    >
    {#if value.length > 0}
      <span
        class="text-muted-foreground text-xs tabular-nums"
        aria-live="polite"
        >{m.costtag_picker_chosen({ count: value.length })}</span
      >
    {/if}
  </div>

  {#if filtering}
    <Input
      type="search"
      class="h-9"
      autocomplete="off"
      aria-label={m.costtag_picker_filter()}
      placeholder={m.costtag_picker_filter()}
      {disabled}
      bind:value={query}
      onkeydown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  {/if}

  <div
    {id}
    role="group"
    aria-labelledby={`${id}-label`}
    aria-describedby={describedby}
    class={cn(
      "flex flex-wrap gap-2",
      filtering && "max-h-44 overflow-y-auto overscroll-contain",
    )}
  >
    {#each shown as tag (tag.id)}
      {@const on = value.includes(tag.id)}
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled || (!on && full)}
        class={cn(
          "focus-visible:ring-ring/50 inline-flex min-h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11",
          on
            ? cn(TAG_COLOR_STYLES[tag.color].chip, "ring-foreground/50 ring-2")
            : "bg-card hover:bg-accent",
        )}
        onclick={() => (value = toggleTagId(value, tag.id, max))}
      >
        {#if on}
          <CheckIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {:else}
          <span
            class={cn(
              "size-2.5 shrink-0 rounded-full",
              TAG_COLOR_STYLES[tag.color].dot,
            )}
            aria-hidden="true"
          ></span>
        {/if}
        <span class="truncate">{tag.name}</span>
      </button>
    {:else}
      {#if all.length === 0}
        <p class="text-muted-foreground text-sm text-pretty">
          {m.costtag_picker_none()}
          {#if !creatable}
            <a
              href={resolve("/settings/cost-tags")}
              class="text-foreground focus-visible:ring-ring/50 rounded font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
              >{m.costtag_picker_none_settings()}</a
            >
          {/if}
        </p>
      {:else}
        <p class="text-muted-foreground text-sm">
          {m.costtag_picker_filter_empty()}
        </p>
      {/if}
    {/each}
    {#if creatable && !adding}
      <button
        type="button"
        {disabled}
        class="text-muted-foreground hover:bg-accent focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed px-3 text-sm font-medium outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11"
        onclick={startAdding}
      >
        <PlusIcon class="size-3.5" aria-hidden="true" />
        {m.costtag_picker_new()}
      </button>
    {/if}
  </div>

  {#if creatable && adding}
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-40 flex-1">
          <Input
            bind:ref={nameEl}
            class="h-10"
            maxlength={COST_TAG_NAME_MAX}
            autocomplete="off"
            aria-label={m.costtag_picker_new_name()}
            placeholder={m.costtag_name_placeholder()}
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? `${id}-create-error` : undefined}
            disabled={creating}
            bind:value={newName}
            onkeydown={onNameKeydown}
          />
        </div>
        <Button size="lg" disabled={creating} onclick={create}>
          {#if creating}
            <LoaderCircleIcon class="animate-spin" />{m.costtag_picker_adding()}
          {:else}
            {m.costtag_picker_add()}
          {/if}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          disabled={creating}
          onclick={stopAdding}
        >
          {m.costtag_picker_cancel()}
        </Button>
      </div>
      {#if createError}
        <p
          id={`${id}-create-error`}
          class="text-destructive text-xs text-pretty"
        >
          {createError}
        </p>
      {/if}
    </div>
  {/if}

  <p
    id={`${id}-hint`}
    class={cn(
      "text-xs text-pretty",
      full ? "text-foreground" : "text-muted-foreground",
    )}
    aria-live="polite"
  >
    {full ? m.costtag_picker_full({ max }) : m.costtag_picker_hint({ max })}
  </p>
  {#if error}
    <p id={`${id}-error`} class="text-destructive text-xs text-pretty">
      {error}
    </p>
  {/if}
</div>
