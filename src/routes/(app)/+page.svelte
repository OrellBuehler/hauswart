<script lang="ts">
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const name = $derived(data.user.displayName || data.user.username);
</script>

<svelte:head>
  <title>{m.dashboard_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.dashboard_greeting({ name })}
    description={m.dashboard_subtitle()}
  />
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.dashboard_soon_title()}</Card.Title>
      <Card.Description>{m.dashboard_soon_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <EmptyState
        icon={ListChecksIcon}
        title={m.dashboard_soon_empty_title()}
        description={m.dashboard_soon_empty_body()}
      />
    </Card.Content>
  </Card.Root>
</div>
