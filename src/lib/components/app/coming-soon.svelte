<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { m } from "$lib/paraglide/messages";
  import EmptyState from "./empty-state.svelte";
  import { navItemFor, type NavHref } from "./nav";
  import PageHeader from "./page-header.svelte";

  let { href }: { href: NavHref } = $props();

  const item = $derived(navItemFor(href));
</script>

<svelte:head>
  <title>{item.label()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={item.label()}>
    {#snippet actions()}
      <Badge variant="secondary">{m.coming_soon_badge()}</Badge>
    {/snippet}
  </PageHeader>
  <EmptyState
    icon={item.icon}
    title={m.coming_soon_badge()}
    description={item.comingSoon?.()}
    class="min-h-64"
  />
</div>
