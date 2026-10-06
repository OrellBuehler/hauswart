<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { ASSET_CONTACT_ROLES, type AssetContactRole } from "$lib/api/enums";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import type { Contact } from "$lib/api/schemas/contacts";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import PickerList from "$lib/components/app/picker-list.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    assetContactRoleLabels,
    contactKindLabels,
  } from "$lib/contacts/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    assetId,
    oncreatenew,
    onlinked,
  }: {
    open?: boolean;
    assetId: string;
    /** Opens the contact form; the caller links the new contact with `role`. */
    oncreatenew: (role: AssetContactRole) => void;
    onlinked: () => void | Promise<void>;
  } = $props();

  let contacts = $state<Contact[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let contactId = $state("");
  let role = $state<string>("service");
  let selectError = $state<string | undefined>();

  const roleOptions = ASSET_CONTACT_ROLES.map((value) => ({
    value,
    label: assetContactRoleLabels[value](),
  }));
  const items = $derived(
    contacts.map((contact) => ({
      value: contact.id,
      label: contact.name,
      detail: [contactKindLabels[contact.kind](), contact.company]
        .filter(Boolean)
        .join(" · "),
    })),
  );

  $effect(() => {
    if (!open) return;
    contactId = "";
    role = "service";
    selectError = undefined;
    void load();
  });

  async function load() {
    loading = true;
    loadError = undefined;
    try {
      contacts = await fetchAll((cursor) =>
        api.call(endpoints.contactsList, { query: { cursor, limit: 200 } }),
      );
    } catch (err) {
      loadError = apiErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  async function submit(): Promise<string | void> {
    selectError = undefined;
    if (!contactId) {
      selectError = m.contact_link_choose();
      return selectError;
    }
    try {
      await api.call(endpoints.assetContactsLink, {
        params: { id: assetId },
        body: { contactId, role: role as AssetContactRole },
      });
    } catch (err) {
      return apiErrorMessage(err, { conflict: m.contact_link_taken() });
    }
    toast.success(m.contact_linked_toast());
    await onlinked();
  }

  function createNew() {
    const chosen = role as AssetContactRole;
    open = false;
    oncreatenew(chosen);
  }
</script>

<FormDialog
  bind:open
  title={m.contact_link_title()}
  description={m.contact_link_description()}
  submitLabel={m.contact_link_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  {#if loading}
    <p class="text-muted-foreground flex items-center gap-2 text-sm">
      <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
      {m.common_loading()}
    </p>
  {:else if loadError}
    <FormAlert message={loadError} />
    <Button type="button" variant="outline" onclick={load}>
      {m.common_retry()}
    </Button>
  {:else}
    <PickerList
      id="link-contact-list"
      {items}
      bind:value={contactId}
      label={m.contact_link_list()}
      emptyText={m.contact_link_empty()}
    />
    {#if selectError}
      <p class="text-destructive -mt-3 text-xs">{selectError}</p>
    {/if}
    <Field id="link-contact-role" label={m.contact_link_role()}>
      {#snippet children({ describedby })}
        <OptionSelect
          id="link-contact-role"
          options={roleOptions}
          bind:value={role}
          {describedby}
        />
      {/snippet}
    </Field>
    <Button type="button" variant="ghost" class="w-fit" onclick={createNew}>
      <PlusIcon />{m.contact_link_create_new()}
    </Button>
  {/if}
</FormDialog>
