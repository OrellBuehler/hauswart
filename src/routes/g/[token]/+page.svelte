<script lang="ts">
  import { resolve } from "$app/paths";
  import type { HintKind } from "$lib/api/enums";
  import GuestHtml from "$lib/components/guest/guest-html.svelte";
  import GuestShell from "$lib/components/guest/guest-shell.svelte";
  import PinForm from "$lib/components/guest/pin-form.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const locale = $derived(data.locale);
  const dialable = (phone: string) => phone.replace(/[^+\d]/g, "");
  const hintLabel = (kind: HintKind) =>
    kind === "warning"
      ? m.guest_hint_warning({}, { locale })
      : kind === "rule"
        ? m.guest_hint_rule({}, { locale })
        : m.guest_hint_tip({}, { locale });
  const groups = $derived(
    data.locked
      ? []
      : [
          {
            title: m.guest_section_emergency({}, { locale }),
            pages: data.home.pages.emergency,
          },
          {
            title: m.guest_section_rules({}, { locale }),
            pages: data.home.pages.rules,
          },
          {
            title: m.guest_section_howto({}, { locale }),
            pages: data.home.pages.howto,
          },
          {
            title: m.guest_section_other({}, { locale }),
            pages: data.home.pages.other,
          },
        ].filter((g) => g.pages.length > 0),
  );
  const empty = $derived(
    !data.locked &&
      data.home.emergencyContacts.length === 0 &&
      data.home.contacts.length === 0 &&
      data.home.devices.length === 0 &&
      groups.length === 0,
  );
</script>

{#snippet contactList(
  title: string,
  list: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  }[],
)}
  {#if list.length > 0}
    <section class="flex break-inside-avoid flex-col gap-2">
      <h2 class="text-xl font-semibold">{title}</h2>
      <ul class="flex flex-col gap-2">
        {#each list as c (c.id)}
          <li class="rounded-lg border p-3">
            <p class="font-medium">{c.name}</p>
            {#if c.company}
              <p class="text-muted-foreground text-sm">{c.company}</p>
            {/if}
            <p class="mt-1 flex flex-wrap gap-x-4 text-sm">
              {#if c.phone}
                <a
                  class="text-brand underline"
                  href={`tel:${dialable(c.phone)}`}
                >
                  {c.phone}
                </a>
              {/if}
              {#if c.email}
                <a class="text-brand underline" href={`mailto:${c.email}`}>
                  {c.email}
                </a>
              {/if}
            </p>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/snippet}

{#if data.locked}
  <GuestShell title={m.guest_pin_title({}, { locale })} {locale}>
    <PinForm {locale} failure={form} />
  </GuestShell>
{:else}
  <GuestShell title={data.home.householdName} {locale} secrets={data.secrets}>
    <header>
      <h1 class="text-3xl font-semibold">{data.home.householdName}</h1>
    </header>

    {@render contactList(
      m.guest_section_emergency_contacts({}, { locale }),
      data.home.emergencyContacts,
    )}

    {#each groups as group (group.title)}
      <section class="flex break-inside-avoid flex-col gap-2">
        <h2 class="text-xl font-semibold">{group.title}</h2>
        <ul class="flex flex-col gap-1">
          {#each group.pages as p (p.slug)}
            <li>
              <a
                class="text-brand underline"
                href={resolve("/g/[token]/docs/[slug]", {
                  token: data.token,
                  slug: p.slug,
                })}
              >
                {p.title}
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if data.home.devices.length > 0}
      <section class="flex flex-col gap-3">
        <h2 class="text-xl font-semibold">
          {m.guest_section_devices({}, { locale })}
        </h2>
        {#each data.home.devices as device (device.id)}
          <article class="break-inside-avoid rounded-lg border p-3">
            <h3 class="font-medium">{device.name}</h3>
            {#if device.roomName}
              <p class="text-muted-foreground text-sm">
                {m.guest_room({ room: device.roomName }, { locale })}
              </p>
            {/if}
            {#each device.hints as hint (hint.id)}
              <div class="mt-2 border-t pt-2">
                <p class="text-sm font-medium">
                  {hintLabel(hint.kind)}: {hint.title}
                </p>
                <GuestHtml html={hint.html} class="text-sm" />
                {#if hint.files.length > 0}
                  <ul class="mt-1 flex flex-wrap gap-x-4 text-sm">
                    {#each hint.files as file (file.id)}
                      <li>
                        <a
                          class="text-brand underline"
                          href={resolve("/g/[token]/files/[id]", {
                            token: data.token,
                            id: file.id,
                          })}
                        >
                          {file.caption ?? file.filename}
                        </a>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </article>
        {/each}
      </section>
    {/if}

    {@render contactList(
      m.guest_section_contacts({}, { locale }),
      data.home.contacts,
    )}

    {#if empty}
      <p class="text-muted-foreground">{m.guest_empty({}, { locale })}</p>
    {/if}
  </GuestShell>
{/if}
