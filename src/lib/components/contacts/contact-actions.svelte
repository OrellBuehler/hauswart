<script lang="ts">
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import MailIcon from "@lucide/svelte/icons/mail";
  import PhoneIcon from "@lucide/svelte/icons/phone";
  import { Button } from "$lib/components/ui/button/index.js";
  import { telHref } from "$lib/contacts/labels";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    contact,
    class: className,
  }: {
    contact: {
      name: string;
      phone: string | null;
      email: string | null;
      url: string | null;
    };
    class?: string;
  } = $props();
</script>

{#if contact.phone || contact.email || contact.url}
  <div class={cn("relative z-10 flex flex-wrap gap-2", className)}>
    {#if contact.phone}
      <Button
        href={telHref(contact.phone)}
        variant="outline"
        size="lg"
        class="max-w-full tabular-nums"
        aria-label={m.contact_call_aria({ name: contact.name })}
      >
        <PhoneIcon />
        <span class="truncate">{contact.phone}</span>
      </Button>
    {/if}
    {#if contact.email}
      <Button
        href={`mailto:${contact.email}`}
        variant="outline"
        size="lg"
        aria-label={m.contact_mail_aria({ name: contact.name })}
      >
        <MailIcon />{m.contact_mail()}
      </Button>
    {/if}
    {#if contact.url}
      <Button
        href={contact.url}
        target="_blank"
        rel="noopener noreferrer"
        variant="outline"
        size="lg"
        aria-label={m.contact_web_aria({ name: contact.name })}
      >
        <GlobeIcon />{m.contact_web()}
      </Button>
    {/if}
  </div>
{/if}
