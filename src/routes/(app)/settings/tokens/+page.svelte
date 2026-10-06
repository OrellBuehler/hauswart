<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import type { ApiToken } from "$lib/api/schemas/tokens";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import TokenRow from "$lib/components/app/token-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import CreateTokenDialog from "./create-token-dialog.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let createOpen = $state(false);
  let target = $state<ApiToken | undefined>();
  let revokeOpen = $state(false);

  function askRevoke(token: ApiToken) {
    target = token;
    revokeOpen = true;
  }

  async function revoke() {
    if (!target) return;
    const { id, name } = target;
    await api.call(endpoints.tokensRevoke, { params: { id } });
    toast.success(m.token_revoked_toast({ name }));
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.tokens_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.tokens_title()}</Card.Title>
    <Card.Description>{m.tokens_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if data.tokens.length === 0}
      <EmptyState
        icon={KeyRoundIcon}
        title={m.tokens_empty_title()}
        description={m.tokens_empty_body()}
      >
        {#snippet actions()}
          <Button onclick={() => (createOpen = true)}>
            <PlusIcon />{m.tokens_create()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="mb-4 flex">
        <Button size="sm" onclick={() => (createOpen = true)}>
          <PlusIcon />{m.tokens_create()}
        </Button>
      </div>
      <ul class="divide-y rounded-lg border">
        {#each data.tokens as token (token.id)}
          <TokenRow
            {token}
            revokeLabel={m.token_revoke()}
            revokeAriaLabel={m.token_revoke_aria({ name: token.name })}
            onrevoke={() => askRevoke(token)}
          />
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<CreateTokenDialog
  bind:open={createOpen}
  scopes={data.scopes}
  oncreated={invalidateAll}
/>

<ConfirmDialog
  bind:open={revokeOpen}
  title={m.token_revoke_title()}
  description={m.token_revoke_description({ name: target?.name ?? "" })}
  confirmLabel={m.token_revoke_confirm()}
  pendingLabel={m.token_revoke_pending()}
  destructive
  onconfirm={revoke}
/>
