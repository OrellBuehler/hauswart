<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import SirenIcon from "@lucide/svelte/icons/siren";
  import { CONTACT_KINDS } from "$lib/api/enums";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import ContactFormDialog from "$lib/components/contacts/contact-form-dialog.svelte";
  import ContactRow from "$lib/components/contacts/contact-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { contactKindGroupLabels } from "$lib/contacts/labels";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let q = $state("");
  let emergencyOnly = $state(false);
  let createOpen = $state(false);

  const query = $derived(q.trim().toLowerCase());
  const visible = $derived(
    data.contacts.filter((contact) => {
      if (emergencyOnly && !contact.emergency) return false;
      if (!query) return true;
      return [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.notes,
      ].some((value) => value?.toLowerCase().includes(query));
    }),
  );
  const groups = $derived(
    CONTACT_KINDS.map((kind) => ({
      kind,
      contacts: visible.filter((contact) => contact.kind === kind),
    })).filter((group) => group.contacts.length > 0),
  );
  const filtered = $derived(emergencyOnly || query !== "");

  function reset() {
    q = "";
    emergencyOnly = false;
  }
</script>

<svelte:head>
  <title>{m.nav_contacts()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_contacts()} description={m.contacts_description()}>
    {#snippet actions()}
      <Button size="lg" onclick={() => (createOpen = true)}>
        <PlusIcon />{m.contacts_create()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if data.contacts.length === 0}
    <EmptyState
      icon={ContactIcon}
      title={m.contacts_empty_title()}
      description={m.contacts_empty_body()}
    >
      {#snippet actions()}
        <Button onclick={() => (createOpen = true)}>
          <PlusIcon />{m.contacts_create()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <section class="flex flex-col gap-3" aria-label={m.contacts_filters()}>
      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="relative flex-1">
          <SearchIcon
            class="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            class="h-10 ps-9"
            placeholder={m.contacts_search_placeholder()}
            aria-label={m.contacts_search()}
            autocomplete="off"
            bind:value={q}
          />
        </div>
        <Button
          variant="outline"
          size="lg"
          aria-pressed={emergencyOnly}
          class={cn(
            emergencyOnly &&
              "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive dark:bg-destructive/15",
          )}
          onclick={() => (emergencyOnly = !emergencyOnly)}
        >
          <SirenIcon />{m.contacts_emergency_only()}
        </Button>
      </div>
      <div
        class="text-muted-foreground flex items-center justify-between text-xs"
      >
        <p aria-live="polite">
          {m.contacts_count({
            shown: visible.length,
            total: data.contacts.length,
          })}
        </p>
        {#if filtered}
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            onclick={reset}
          >
            {m.contacts_filter_reset()}
          </Button>
        {/if}
      </div>
    </section>

    {#if visible.length === 0}
      <EmptyState
        icon={SearchXIcon}
        title={m.contacts_no_results_title()}
        description={m.contacts_no_results_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}>
            {m.contacts_filter_reset()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="flex flex-col gap-6">
        {#each groups as group (group.kind)}
          <section aria-labelledby={`group-${group.kind}`}>
            <h2
              id={`group-${group.kind}`}
              class="text-muted-foreground mb-2 flex items-baseline gap-2 text-sm font-semibold"
            >
              {contactKindGroupLabels[group.kind]()}
              <span class="text-xs font-normal tabular-nums">
                {group.contacts.length}
              </span>
            </h2>
            <ul class="bg-card shadow-card divide-y rounded-xl border">
              {#each group.contacts as contact (contact.id)}
                <ContactRow {contact} />
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<ContactFormDialog bind:open={createOpen} onsaved={() => invalidateAll()} />
