<script lang="ts">
  import WifiOffIcon from "@lucide/svelte/icons/wifi-off";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Logo from "$lib/components/app/logo.svelte";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
</script>

<svelte:head>
  <title>{m.offline_title()} · {m.app_name()}</title>
</svelte:head>

<main class="flex min-h-svh items-center justify-center p-4">
  <div class="flex w-full max-w-sm flex-col items-center gap-6">
    <Logo />
    <EmptyState
      icon={WifiOffIcon}
      title={m.offline_title()}
      description={m.offline_description()}
      class="w-full"
    >
      {#snippet actions()}
        <!-- "?" is the page the visitor asked for (this one only stands in for it). -->
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href="?" class={buttonVariants()}>{m.offline_retry()}</a>
      {/snippet}
    </EmptyState>
  </div>
</main>
