<script lang="ts">
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import { resolve } from "$app/paths";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import { isMoreActive, isNavActive, mobileTabs } from "./nav";
  import { opensKeyboard } from "./text-entry";

  let { pathname }: { pathname: string } = $props();

  const sidebar = Sidebar.useSidebar();
  const more = $derived(isMoreActive(pathname));

  // The on-screen keyboard covers the bottom of the screen: the bar steps aside while a field has it.
  let typing = $state(false);

  const tab =
    "relative flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight font-medium outline-hidden transition-colors focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset";
  const marker =
    "before:bg-brand before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full";
  const tone = (active: boolean) =>
    active
      ? cn("text-brand", marker)
      : "text-muted-foreground active:bg-accent";
</script>

<svelte:document
  onfocusin={(event) => (typing = opensKeyboard(event.target as Element))}
  onfocusout={(event) =>
    (typing = opensKeyboard(event.relatedTarget as Element | null))}
/>

{#if !typing}
  <nav
    aria-label={m.nav_bottom_aria()}
    data-bottom-nav
    class="bg-background/90 fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-border)] backdrop-blur-md md:hidden print:hidden"
  >
    {#each mobileTabs as item (item.href)}
      {@const active = isNavActive(item, pathname)}
      <a
        href={resolve(item.href)}
        aria-current={active ? "page" : undefined}
        class={cn(tab, tone(active))}
      >
        <item.icon class="size-5" aria-hidden="true" />
        <span class="max-w-full truncate">
          {(item.shortLabel ?? item.label)()}
        </span>
      </a>
    {/each}
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={sidebar.openMobile}
      class={cn(tab, tone(more))}
      onclick={() => sidebar.setOpenMobile(true)}
    >
      <EllipsisIcon class="size-5" aria-hidden="true" />
      <span class="max-w-full truncate">{m.nav_more()}</span>
    </button>
  </nav>
{/if}
