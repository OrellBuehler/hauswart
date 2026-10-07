<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import XIcon from "@lucide/svelte/icons/x";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { m } from "$lib/paraglide/messages";

  let {
    id,
    values,
    onadd,
    onremove,
    placeholder,
    emptyText,
    removeLabel,
    maxLength = 200,
    full = false,
    describedby,
  }: {
    id: string;
    values: string[];
    onadd: (name: string) => void;
    onremove: (name: string) => void;
    placeholder: string;
    emptyText: string;
    removeLabel: (name: string) => string;
    maxLength?: number;
    /** The list cannot take more names. */
    full?: boolean;
    describedby?: string | undefined;
  } = $props();

  let draft = $state("");

  function commit() {
    const name = draft.trim();
    draft = "";
    if (name !== "") onadd(name);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    // Enter adds the name; it must not submit the surrounding form.
    event.preventDefault();
    commit();
  }
</script>

<div class="flex flex-col gap-2">
  {#if values.length > 0}
    <ul class="flex flex-wrap gap-1.5">
      {#each values as name (name)}
        <li class="max-w-full">
          <Badge
            variant="secondary"
            class="h-auto max-w-full gap-1 py-0.5 ps-2.5 pe-0.5 text-start whitespace-normal"
          >
            <span class="min-w-0 break-words">{name}</span>
            <button
              type="button"
              class="hover:bg-foreground/10 focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
              aria-label={removeLabel(name)}
              onclick={() => onremove(name)}
            >
              <XIcon aria-hidden="true" />
            </button>
          </Badge>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-muted-foreground text-sm">{emptyText}</p>
  {/if}
  <div class="flex gap-2">
    <Input
      {id}
      class="h-10"
      autocomplete="off"
      spellcheck={false}
      maxlength={maxLength}
      {placeholder}
      disabled={full}
      aria-describedby={describedby}
      bind:value={draft}
      {onkeydown}
      onblur={commit}
    />
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="size-10 shrink-0"
      aria-label={m.common_add()}
      disabled={full || draft.trim() === ""}
      onclick={commit}
    >
      <PlusIcon />
    </Button>
  </div>
</div>
