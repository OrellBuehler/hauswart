<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import SmartphoneIcon from "@lucide/svelte/icons/smartphone";
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import type { ApiToken } from "$lib/api/schemas/tokens";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import TokenRow from "$lib/components/app/token-row.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let target = $state<ApiToken | undefined>();
  let open = $state(false);

  function ask(device: ApiToken) {
    target = device;
    open = true;
  }

  async function signOut() {
    if (!target) return;
    const { id, name } = target;
    await api.call(endpoints.tokensRevoke, { params: { id } });
    toast.success(m.device_signout_toast({ name }));
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.devices_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.devices_title()}</Card.Title>
    <Card.Description>{m.devices_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if data.devices.length === 0}
      <EmptyState
        icon={SmartphoneIcon}
        title={m.devices_empty_title()}
        description={m.devices_empty_body()}
      />
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each data.devices as device (device.id)}
          <TokenRow
            token={device}
            revokeLabel={m.device_signout()}
            revokeAriaLabel={m.device_signout_aria({ name: device.name })}
            onrevoke={() => ask(device)}
          />
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<ConfirmDialog
  bind:open
  title={m.device_signout_title()}
  description={m.device_signout_description({ name: target?.name ?? "" })}
  confirmLabel={m.device_signout_confirm()}
  pendingLabel={m.device_signout_pending()}
  destructive
  onconfirm={signOut}
/>
