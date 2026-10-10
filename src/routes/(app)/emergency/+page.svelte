<script lang="ts">
  import { resolve } from "$app/paths";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import CpuIcon from "@lucide/svelte/icons/cpu";
  import FileDownIcon from "@lucide/svelte/icons/file-down";
  import LinkIcon from "@lucide/svelte/icons/link-2";
  import MailIcon from "@lucide/svelte/icons/mail";
  import PhoneIcon from "@lucide/svelte/icons/phone";
  import PrinterIcon from "@lucide/svelte/icons/printer";
  import SirenIcon from "@lucide/svelte/icons/siren";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { endpointUrl } from "$lib/api/client";
  import { endpoints } from "$lib/api/registry";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import DocProse from "$lib/components/docs/doc-prose.svelte";
  import HintCallout from "$lib/components/hints/hint-callout.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { telHref } from "$lib/contacts/labels";
  import { sectionLabels } from "$lib/docs/sections";
  import { assetHref, contactHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const emergency = $derived(data.emergency);

  let includeSecrets = $state(false);

  const pdfHref = $derived(
    endpointUrl(endpoints.emergencyExport, {
      query: includeSecrets ? { includeSecrets: "1" } : {},
    }),
  );
  const empty = $derived(
    emergency.contacts.length === 0 &&
      emergency.assets.length === 0 &&
      emergency.pages.length === 0,
  );
</script>

<svelte:head>
  <title>{m.emergency_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-8 print:gap-5">
  <PageHeader
    title={m.emergency_title()}
    description={m.emergency_description({ name: emergency.household.name })}
  >
    {#snippet actions()}
      <Button
        type="button"
        variant="outline"
        size="lg"
        class="max-sm:hidden print:hidden"
        onclick={() => window.print()}
      >
        <PrinterIcon />{m.emergency_print()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if empty}
    <EmptyState
      icon={SirenIcon}
      title={m.emergency_empty_title()}
      description={m.emergency_empty_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/contacts")}>
          <ContactIcon />{m.emergency_empty_contacts()}
        </Button>
        <Button href={resolve("/docs/new")} variant="outline">
          {m.emergency_empty_page()}
        </Button>
      {/snippet}
    </EmptyState>
  {/if}

  {#if emergency.contacts.length > 0}
    <section class="flex flex-col gap-3" aria-labelledby="emergency-contacts">
      <h2 id="emergency-contacts" class="text-lg font-semibold">
        {m.emergency_contacts()}
      </h2>
      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {#each emergency.contacts as contact (contact.id)}
          <li
            class="bg-card flex break-inside-avoid flex-col gap-3 rounded-xl border-2 p-4 print:rounded-lg print:border print:p-3"
          >
            <div class="min-w-0">
              <a
                href={contactHref(contact.id)}
                class="font-semibold wrap-anywhere underline-offset-4 hover:underline print:no-underline"
              >
                {contact.name}
              </a>
              {#if contact.company && contact.company !== contact.name}
                <p class="text-muted-foreground text-sm wrap-anywhere">
                  {contact.company}
                </p>
              {/if}
              {#if contact.notes}
                <p
                  class="text-muted-foreground mt-1 text-sm wrap-anywhere whitespace-pre-line"
                >
                  {contact.notes}
                </p>
              {/if}
            </div>
            {#if contact.phone}
              <Button
                href={telHref(contact.phone)}
                variant="destructive"
                class="h-14 w-full gap-3 rounded-lg text-xl font-semibold tabular-nums print:h-auto print:justify-start print:bg-transparent print:px-0! print:text-lg print:font-semibold print:text-black print:shadow-none"
                aria-label={m.contact_call_aria({ name: contact.name })}
              >
                <PhoneIcon
                  class="size-5 shrink-0 print:hidden"
                  aria-hidden="true"
                />
                <span class="min-w-0 truncate">{contact.phone}</span>
              </Button>
            {/if}
            {#if contact.email}
              <Button
                href={`mailto:${contact.email}`}
                variant="outline"
                size="lg"
                class="max-w-full min-w-0 print:hidden"
                aria-label={m.contact_mail_aria({ name: contact.name })}
              >
                <MailIcon /><span class="truncate">{contact.email}</span>
              </Button>
              <p class="hidden text-sm wrap-anywhere print:block">
                {contact.email}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if emergency.assets.length > 0}
    <section class="flex flex-col gap-3" aria-labelledby="emergency-assets">
      <h2 id="emergency-assets" class="text-lg font-semibold">
        {m.emergency_assets()}
      </h2>
      <ul class="grid grid-cols-1 gap-3 md:grid-cols-2">
        {#each emergency.assets as asset (asset.id)}
          <li
            class="bg-card flex break-inside-avoid flex-col gap-3 rounded-xl border p-4"
          >
            <div class="flex items-start gap-3">
              <span
                class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg print:hidden"
                aria-hidden="true"
              >
                <CpuIcon class="size-5" />
              </span>
              <div class="min-w-0">
                <a
                  href={assetHref(asset.id)}
                  class="font-semibold wrap-anywhere underline-offset-4 hover:underline print:no-underline"
                >
                  {asset.name}
                </a>
                {#if asset.roomName}
                  <p class="text-muted-foreground text-sm wrap-anywhere">
                    {m.emergency_room({ room: asset.roomName })}
                  </p>
                {/if}
              </div>
            </div>
            {#if asset.pinnedHints.length > 0}
              <ul class="flex flex-col gap-2">
                {#each asset.pinnedHints as hint (hint.id)}
                  <HintCallout {hint} prominent />
                {/each}
              </ul>
            {:else}
              <p class="text-muted-foreground text-sm">
                {m.emergency_no_hints()}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#each emergency.pages as page (page.id)}
    <section
      class="flex flex-col gap-3 print:break-before-auto"
      aria-labelledby={`emergency-page-${page.id}`}
    >
      <div
        class="flex break-after-avoid flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <h2
          id={`emergency-page-${page.id}`}
          class="min-w-0 text-lg font-semibold wrap-anywhere"
        >
          {page.title}
        </h2>
        <div class="flex items-center gap-2 print:hidden">
          <Badge variant="secondary">{sectionLabels[page.section]()}</Badge>
          <a
            href={resolve(`/docs/${encodeURIComponent(page.slug)}` as "/")}
            class="text-brand text-sm font-medium underline underline-offset-4"
          >
            {m.emergency_open_page()}
          </a>
        </div>
      </div>
      <Card.Root class="print:border-0 print:shadow-none">
        <Card.Content class="print:p-0">
          <DocProse html={page.renderedHtml} />
        </Card.Content>
      </Card.Root>
    </section>
  {/each}

  <section
    class="grid grid-cols-1 items-start gap-4 md:grid-cols-2 print:hidden"
    aria-label={m.emergency_share_title()}
  >
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          <FileDownIcon
            class="size-4"
            aria-hidden="true"
          />{m.emergency_sheet_title()}
        </Card.Title>
        <Card.Description>{m.emergency_sheet_description()}</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          <Checkbox
            id="emergency-secrets"
            class="mt-0.5"
            bind:checked={includeSecrets}
          />
          <Label
            for="emergency-secrets"
            class="flex flex-col items-start gap-0.5"
          >
            <span>{m.emergency_sheet_secrets()}</span>
            <span class="text-muted-foreground text-xs font-normal text-pretty">
              {m.emergency_sheet_secrets_hint()}
            </span>
          </Label>
        </div>
        {#if includeSecrets}
          <div
            class="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm"
            role="note"
          >
            <TriangleAlertIcon
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p class="text-pretty">{m.emergency_sheet_secrets_warning()}</p>
          </div>
        {/if}
        <Button
          href={pdfHref}
          download
          data-sveltekit-reload
          size="lg"
          class="self-start"
        >
          <FileDownIcon />{m.emergency_sheet_download()}
        </Button>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          <LinkIcon
            class="size-4"
            aria-hidden="true"
          />{m.emergency_guest_title()}
        </Card.Title>
        <Card.Description>{m.emergency_guest_description()}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Button href={resolve("/settings/guest-links")} size="lg">
          <LinkIcon />{m.emergency_guest_cta()}
        </Button>
      </Card.Content>
    </Card.Root>
  </section>
</div>
