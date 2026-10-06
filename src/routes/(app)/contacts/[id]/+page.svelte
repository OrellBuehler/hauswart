<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import SirenIcon from "@lucide/svelte/icons/siren";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import ContactActions from "$lib/components/contacts/contact-actions.svelte";
  import ContactFormDialog from "$lib/components/contacts/contact-form-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import {
    assetContactRoleLabels,
    contactKindIcons,
    contactKindLabels,
    telHref,
  } from "$lib/contacts/labels";
  import { assetHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let editOpen = $state(false);
  let deleteOpen = $state(false);

  const contact = $derived(data.contact);
  const Icon = $derived(contactKindIcons[contact.kind]);

  async function remove() {
    const { id, name } = contact;
    await api.call(endpoints.contactsDelete, { params: { id } });
    toast.success(m.contact_deleted_toast({ name }));
    await goto(resolve("/contacts"), { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>{contact.name} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/contacts")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit"
    >
      <ArrowLeftIcon />{m.nav_contacts()}
    </Button>
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          <Icon class="size-6" />
        </span>
        <div class="min-w-0">
          <h1
            class="text-2xl font-semibold tracking-tight text-balance break-words md:text-3xl"
          >
            {contact.name}
          </h1>
          <p
            class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          >
            <span>{contactKindLabels[contact.kind]()}</span>
            {#if contact.company}
              <span aria-hidden="true">·</span>
              <span>{contact.company}</span>
            {/if}
            {#if contact.emergency}
              <Badge
                variant="outline"
                class="border-destructive/30 bg-destructive/10 text-destructive"
              >
                <SirenIcon aria-hidden="true" />{m.contact_emergency_badge()}
              </Badge>
            {/if}
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          class="max-sm:hidden"
          onclick={() => (editOpen = true)}
        >
          <PencilIcon />{m.common_edit()}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon"
                aria-label={m.contact_actions()}
              >
                <EllipsisVerticalIcon />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              class="min-h-10 sm:hidden"
              onSelect={() => (editOpen = true)}
            >
              <PencilIcon />{m.common_edit()}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              variant="destructive"
              class="min-h-10"
              onSelect={() => (deleteOpen = true)}
            >
              <Trash2Icon />{m.common_delete()}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </header>
    <ContactActions {contact} />
  </div>

  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
    <div class="flex min-w-0 flex-col gap-6 lg:col-span-2">
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.contact_details_title()}</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-5">
          <dl
            class="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-3 text-sm sm:gap-x-6"
          >
            <dt class="text-muted-foreground">{m.contact_phone()}</dt>
            <dd class="font-medium break-words tabular-nums">
              {#if contact.phone}
                <Button
                  href={telHref(contact.phone)}
                  variant="link"
                  class="h-auto p-0 font-medium"
                >
                  {contact.phone}
                </Button>
              {:else}
                <span class="text-muted-foreground font-normal">–</span>
              {/if}
            </dd>
            <dt class="text-muted-foreground">{m.contact_email()}</dt>
            <dd class="font-medium break-all">
              {#if contact.email}
                <Button
                  href={`mailto:${contact.email}`}
                  variant="link"
                  class="h-auto p-0 font-medium break-all whitespace-normal"
                >
                  {contact.email}
                </Button>
              {:else}
                <span class="text-muted-foreground font-normal">–</span>
              {/if}
            </dd>
            <dt class="text-muted-foreground">{m.contact_url()}</dt>
            <dd class="font-medium break-all">
              {#if contact.url}
                <Button
                  href={contact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="link"
                  class="h-auto p-0 text-start font-medium break-all whitespace-normal"
                >
                  {contact.url}
                </Button>
              {:else}
                <span class="text-muted-foreground font-normal">–</span>
              {/if}
            </dd>
            <dt class="text-muted-foreground">{m.contact_address()}</dt>
            <dd class="font-medium break-words whitespace-pre-line">
              {#if contact.address}
                {contact.address}
              {:else}
                <span class="text-muted-foreground font-normal">–</span>
              {/if}
            </dd>
            <dt class="text-muted-foreground">{m.contact_guest_visible()}</dt>
            <dd class="flex items-center gap-1.5 font-medium">
              {#if contact.guestVisible}
                <EyeIcon class="size-4" aria-hidden="true" />
              {/if}
              {contact.guestVisible ? m.common_yes() : m.common_no()}
            </dd>
          </dl>
          {#if contact.notes}
            <div class="border-t pt-4">
              <h3 class="text-muted-foreground mb-1.5 text-sm">
                {m.contact_notes()}
              </h3>
              <p class="text-sm break-words whitespace-pre-line">
                {contact.notes}
              </p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </div>

    <Card.Root>
      <Card.Header>
        <Card.Title>{m.contact_assets_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
        {#if contact.assets.length === 0}
          <EmptyState
            icon={BoxesIcon}
            title={m.contact_assets_empty_title()}
            description={m.contact_assets_empty_body()}
            class="py-8"
          />
        {:else}
          <ul class="divide-y">
            {#each contact.assets as link (link.linkId)}
              <li>
                <a
                  href={assetHref(link.assetId)}
                  class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors outline-none focus-visible:ring-[3px]"
                >
                  <span class="min-w-0 truncate text-sm font-medium">
                    {link.assetName}
                  </span>
                  <Badge variant="secondary">
                    {assetContactRoleLabels[link.role]()}
                  </Badge>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>

    <Attachments
      ownerType="contact"
      ownerId={contact.id}
      title={m.contact_files_title()}
    />
  </div>
</div>

<ContactFormDialog
  bind:open={editOpen}
  {contact}
  onsaved={() => invalidateAll()}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.contact_delete_title()}
  description={m.contact_delete_description({ name: contact.name })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
