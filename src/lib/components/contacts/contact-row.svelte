<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import SirenIcon from "@lucide/svelte/icons/siren";
  import {
    assetContactRoleLabels,
    contactKindIcons,
  } from "$lib/contacts/labels";
  import type { AssetContactRole } from "$lib/api/enums";
  import type { Contact } from "$lib/api/schemas/contacts";
  import { contactHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { Snippet } from "svelte";
  import ContactActions from "./contact-actions.svelte";

  let {
    contact,
    role,
    trailing,
  }: {
    contact: Contact;
    /** Shown when the row lists a contact of an asset. */
    role?: AssetContactRole;
    trailing?: Snippet;
  } = $props();

  const Icon = $derived(contactKindIcons[contact.kind]);
</script>

<li class="relative flex flex-col gap-3 px-4 py-3.5">
  <div class="flex items-start gap-3">
    <span
      class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <Icon class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={contactHref(contact.id)}
          class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 min-w-0 rounded-sm font-medium wrap-anywhere underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-[3px]"
        >
          {contact.name}
        </a>
        {#if contact.emergency}
          <Badge
            variant="outline"
            class="border-destructive/30 bg-destructive/10 text-destructive"
          >
            <SirenIcon aria-hidden="true" />{m.contact_emergency_badge()}
          </Badge>
        {/if}
        {#if role}
          <Badge variant="secondary">{assetContactRoleLabels[role]()}</Badge>
        {/if}
      </div>
      {#if contact.company}
        <p class="text-muted-foreground truncate text-sm">{contact.company}</p>
      {/if}
    </div>
    {#if trailing}
      <div class="relative z-10 shrink-0">{@render trailing()}</div>
    {/if}
  </div>
  <ContactActions {contact} class="sm:ps-[3.25rem]" />
</li>
