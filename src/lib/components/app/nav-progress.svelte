<script lang="ts">
  import { navigating } from "$app/state";
  import { m } from "$lib/paraglide/messages";
</script>

<!-- Shows after a short delay so that quick navigations do not flash it. -->
{#if navigating.to}
  <div
    role="progressbar"
    aria-label={m.nav_loading()}
    class="animate-in fade-in fill-mode-backwards pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden delay-200 duration-200 print:hidden"
  >
    <div class="bg-brand h-full w-full animate-pulse"></div>
  </div>
{/if}
