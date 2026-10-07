<script lang="ts">
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import { cn } from "$lib/utils";

  let {
    url,
    class: className,
  }: {
    /** The proxied thumbnail; null (or one that fails to load) shows a file icon instead. */
    url: string | null;
    class?: string;
  } = $props();

  let failed = $state<string | null>(null);
  const showImage = $derived(url !== null && failed !== url);
</script>

<span
  class={cn(
    "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border",
    className,
  )}
  aria-hidden="true"
>
  {#if showImage}
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      class="size-full object-cover object-top"
      onerror={() => (failed = url)}
    />
  {:else}
    <FileTextIcon class="size-5" />
  {/if}
</span>
