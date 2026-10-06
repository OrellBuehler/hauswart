<script lang="ts">
  import SearchIcon from "@lucide/svelte/icons/search";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import SearchDialog from "./search-dialog.svelte";

  let open = $state(false);
  let mac = $state(false);

  onMount(() => {
    mac = /mac|iphone|ipad/i.test(navigator.platform);
  });

  function onkeydown(event: KeyboardEvent) {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "k"
    ) {
      event.preventDefault();
      open = !open;
    }
  }
</script>

<svelte:window {onkeydown} />

<Button
  type="button"
  variant="outline"
  class="text-muted-foreground hidden h-8 w-52 justify-start gap-2 px-3 font-normal sm:inline-flex lg:w-64"
  aria-label={m.search_open()}
  aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
  onclick={() => (open = true)}
>
  <SearchIcon aria-hidden="true" />
  <span class="flex-1 truncate text-start">{m.search_trigger()}</span>
  <kbd class="bg-muted rounded border px-1.5 text-[0.7rem] font-medium">
    {mac ? "⌘K" : "Ctrl K"}
  </kbd>
</Button>
<Button
  type="button"
  variant="ghost"
  size="icon"
  class="size-9 sm:hidden"
  aria-label={m.search_open()}
  onclick={() => (open = true)}
>
  <SearchIcon />
</Button>

<SearchDialog bind:open />
