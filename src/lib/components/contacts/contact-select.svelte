<script lang="ts">
  import { api } from "$lib/api/browser";
  import type { ContactKind } from "$lib/api/enums";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import type { Contact } from "$lib/api/schemas/contacts";
  import OptionSelect from "$lib/components/assets/option-select.svelte";
  import { preferKind as preferContactKind } from "$lib/contacts/order";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    id,
    value = $bindable(null),
    preferKind,
    class: className,
  }: {
    id?: string;
    value?: string | null;
    /** The contacts of this kind are listed first (the insurer of a policy: `insurance`). */
    preferKind?: ContactKind;
    class?: string;
  } = $props();

  let contacts = $state<Contact[]>([]);
  let error = $state<string | undefined>();

  const options = $derived(
    preferContactKind(contacts, preferKind).map((contact) => ({
      value: contact.id,
      label: contact.company
        ? `${contact.name} · ${contact.company}`
        : contact.name,
    })),
  );

  $effect(() => {
    let cancelled = false;
    fetchAll((cursor) =>
      api.call(endpoints.contactsList, { query: { cursor, limit: 200 } }),
    ).then(
      (all) => {
        if (!cancelled) contacts = all;
      },
      (err) => {
        if (!cancelled) error = apiErrorMessage(err);
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

<OptionSelect
  {id}
  {options}
  bind:value
  noneLabel={m.contact_select_none()}
  class={className}
/>
{#if error}
  <p class="text-destructive text-xs">{error}</p>
{/if}
