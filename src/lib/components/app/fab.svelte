<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import type { Component, Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils";

  /**
   * The main action of a page as a round button above the bottom bar on phones (hidden from `md`
   * up, where the page header offers the same action). `href` is the resolved address
   * (`resolve("/tasks/new")`); `label` is the accessible name. The icon is a component (a plus by
   * default); a `children` snippet replaces the whole content.
   */
  let {
    href,
    label,
    icon: Icon = PlusIcon,
    children,
    class: className,
  }: {
    href: string;
    label: string;
    icon?: Component;
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<Button
  {href}
  aria-label={label}
  size="icon-lg"
  class={cn(
    "fixed end-4 bottom-[calc(var(--bottom-nav,0px)+env(safe-area-inset-bottom)+1rem)] z-30 size-14 rounded-full shadow-lg md:hidden print:hidden",
    className,
  )}
>
  {#if children}
    {@render children()}
  {:else}
    <Icon class="size-6" aria-hidden="true" />
  {/if}
</Button>
