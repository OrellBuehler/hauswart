<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import XIcon from "@lucide/svelte/icons/x";
  import { normalizeHostEntry } from "$lib/hosts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";

  let {
    id,
    value = $bindable([]),
    disabled = false,
    max = 50,
  }: {
    id?: string;
    value?: string[];
    disabled?: boolean;
    max?: number;
  } = $props();

  let draft = $state("");
  let invalid = $state(false);

  function commit() {
    const parts = draft.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 0) {
      invalid = false;
      return;
    }
    const entries = parts.map(normalizeHostEntry);
    if (entries.some((entry) => entry === null)) {
      invalid = true;
      return;
    }
    const next = [...value];
    for (const entry of entries as string[]) {
      if (!next.includes(entry) && next.length < max) next.push(entry);
    }
    value = next;
    draft = "";
    invalid = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      value = value.slice(0, -1);
    }
  }

  function remove(host: string) {
    value = value.filter((entry) => entry !== host);
  }
</script>

<div class="flex flex-col gap-2">
  {#if value.length > 0}
    <ul class="flex flex-wrap gap-1.5">
      {#each value as host (host)}
        <li class="max-w-full">
          <Badge
            variant="secondary"
            class="h-auto max-w-full gap-1 pe-1 text-start font-mono whitespace-normal"
          >
            <span class="min-w-0 break-all">{host}</span>
            {#if !disabled}
              <button
                type="button"
                class="hover:bg-foreground/10 focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 pointer-coarse:-me-1 pointer-coarse:size-8"
                aria-label={m.household_host_allowlist_remove({ host })}
                onclick={() => remove(host)}
              >
                <XIcon />
              </button>
            {/if}
          </Badge>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-muted-foreground text-xs">
      {m.household_host_allowlist_empty()}
    </p>
  {/if}
  {#if !disabled}
    <div class="flex gap-2">
      <Input
        {id}
        autocomplete="off"
        autocapitalize="none"
        enterkeyhint="done"
        spellcheck="false"
        placeholder={m.household_host_allowlist_placeholder()}
        aria-invalid={invalid}
        bind:value={draft}
        {onkeydown}
        onblur={commit}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={m.common_add()}
        disabled={draft.trim() === ""}
        onclick={commit}
      >
        <PlusIcon />
      </Button>
    </div>
    {#if invalid}
      <p class="text-destructive text-xs" role="alert">
        {m.household_host_allowlist_invalid()}
      </p>
    {/if}
  {/if}
</div>
