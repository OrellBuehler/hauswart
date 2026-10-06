<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { forgetIntegrations } from "$lib/connections/connection";
  import { cardFor } from "$lib/components/connections/cards";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const isAdmin = $derived(data.user.role === "admin");

  async function reload() {
    forgetIntegrations();
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.integrations_title()} · {m.settings_title()} · {m.app_name()}</title
  >
</svelte:head>

<div class="flex max-w-3xl flex-col gap-6">
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
      timeZone={data.timeZone}
      onchanged={reload}
    />
  {/each}
</div>
