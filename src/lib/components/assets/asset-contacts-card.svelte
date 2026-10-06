<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import UnlinkIcon from "@lucide/svelte/icons/unlink";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { AssetContactRole } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { AssetContact } from "$lib/api/schemas/contacts";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import ContactFormDialog from "$lib/components/contacts/contact-form-dialog.svelte";
  import ContactRow from "$lib/components/contacts/contact-row.svelte";
  import LinkContactDialog from "$lib/components/contacts/link-contact-dialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let { assetId, links }: { assetId: string; links: AssetContact[] } = $props();

  let linkOpen = $state(false);
  let createOpen = $state(false);
  let newRole = $state<AssetContactRole>("service");
  let busyId = $state<string | null>(null);

  function createNew(role: AssetContactRole) {
    newRole = role;
    createOpen = true;
  }

  async function linkCreated(contact: { id: string }) {
    try {
      await api.call(endpoints.assetContactsLink, {
        params: { id: assetId },
        body: { contactId: contact.id, role: newRole },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  }

  async function relink(link: AssetContact) {
    try {
      await api.call(endpoints.assetContactsLink, {
        params: { id: assetId },
        body: { contactId: link.contactId, role: link.role },
      });
      toast.success(m.toast_undone());
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
    await invalidateAll();
  }

  async function unlink(link: AssetContact) {
    if (busyId) return;
    busyId = link.id;
    try {
      await api.call(endpoints.assetContactsUnlink, {
        params: { id: assetId, linkId: link.id },
      });
      await invalidateAll();
      toast.success(m.contact_unlinked_toast({ name: link.contact.name }), {
        action: { label: m.common_undo(), onClick: () => void relink(link) },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busyId = null;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.asset_contacts_title()}</Card.Title>
    <Card.Action>
      <Button size="sm" variant="outline" onclick={() => (linkOpen = true)}>
        <PlusIcon />{m.contact_link_add()}
      </Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if links.length === 0}
      <EmptyState
        icon={ContactIcon}
        title={m.asset_contacts_empty_title()}
        description={m.asset_contacts_empty_body()}
        class="py-8"
      >
        {#snippet actions()}
          <Button onclick={() => (linkOpen = true)}>
            <PlusIcon />{m.contact_link_add()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each links as link (link.id)}
          <ContactRow contact={link.contact} role={link.role}>
            {#snippet trailing()}
              <Button
                variant="ghost"
                size="icon"
                disabled={busyId !== null}
                aria-label={m.contact_unlink_aria({
                  name: link.contact.name,
                })}
                onclick={() => unlink(link)}
              >
                <UnlinkIcon />
              </Button>
            {/snippet}
          </ContactRow>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

<LinkContactDialog
  bind:open={linkOpen}
  {assetId}
  oncreatenew={createNew}
  onlinked={() => invalidateAll()}
/>
<ContactFormDialog bind:open={createOpen} onsaved={linkCreated} />
