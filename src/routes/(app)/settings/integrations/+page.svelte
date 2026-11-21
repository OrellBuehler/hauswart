<script lang="ts">
  import { refreshAll } from "$app/navigation";
  import { forgetIntegrations } from "#lib/connections/connection.ts";
  import { cardFor } from "#lib/components/connections/cards.ts";
  import { m } from "#lib/paraglide/messages.js";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const isAdmin = $derived(data.user.role === "admin");

  async function reload() {
    forgetIntegrations();
    await refreshAll();
  }
</script>

<svelte:head>
  <title>{m.integrations_title()} · {m.settings_title()} · {m.app_name()}</title
  >
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-1">
    <h2 class="text-lg font-semibold tracking-tight">
      {m.integrations_title()}
    </h2>
    <p class="text-muted-foreground text-sm text-pretty">
      {isAdmin
        ? m.integrations_description()
        : m.integrations_description_readonly()}
    </p>
  </div>

  {#each data.integrations as integration (integration.kind)}
    {@const Card = cardFor(integration.kind)}
    <Card
      {integration}
      canEdit={integration.level === "user" || isAdmin}
      {isAdmin}
      timeZone={data.timeZone}
      books={data.books}
      onchanged={reload}
    />
  {/each}
</div>
