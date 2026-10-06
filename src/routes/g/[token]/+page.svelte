<script lang="ts">
  import { resolve } from "$app/paths";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import MailIcon from "@lucide/svelte/icons/mail";
  import PhoneIcon from "@lucide/svelte/icons/phone";
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
  urgent: boolean,
)}
  {#if list.length > 0}
    <section class="flex flex-col gap-3">
      <h2 class="text-xl font-semibold">{title}</h2>
      <ul class="grid gap-3 sm:grid-cols-2">
        {#each list as c (c.id)}
          <li
            class="bg-card flex break-inside-avoid flex-col gap-3 rounded-xl border p-4 print:rounded-lg print:p-3"
          >
            <div class="min-w-0">
              <p class="font-semibold break-words">{c.name}</p>
              {#if c.company && c.company !== c.name}
                <p class="text-muted-foreground text-sm break-words">
                  {c.company}
                </p>
              {/if}
            </div>
            {#if c.phone}
              <a
                class={urgent
                  ? "bg-destructive flex min-h-14 items-center justify-center gap-3 rounded-lg px-4 text-xl font-semibold text-white tabular-nums print:min-h-0 print:justify-start print:bg-transparent print:px-0 print:text-lg print:text-black"
                  : "flex min-h-12 items-center justify-center gap-2.5 rounded-lg border px-4 text-lg font-medium tabular-nums print:min-h-0 print:justify-start print:border-0 print:px-0"}
                href={`tel:${dialable(c.phone)}`}
              >
                <PhoneIcon
                  class="size-5 shrink-0 print:hidden"
                  aria-hidden="true"
                />
                {c.phone}
              </a>
            {/if}
            {#if c.email}
              <a
                class="text-brand flex min-h-11 items-center gap-2 text-sm font-medium break-all underline underline-offset-4"
                href={`mailto:${c.email}`}
              >
                <MailIcon
                  class="size-4 shrink-0 print:hidden"
                  aria-hidden="true"
                />
                {c.email}
              </a>
            {/if}
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
      true,
    )}

    {#each groups as group (group.title)}
      <section class="flex flex-col gap-3">
        <h2 class="text-xl font-semibold">{group.title}</h2>
        <ul class="flex flex-col gap-2">
          {#each group.pages as p (p.slug)}
            <li>
              <a
                class="bg-card hover:bg-accent focus-visible:ring-ring/50 flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-2 font-medium break-words outline-none focus-visible:ring-[3px]"
                href={resolve("/g/[token]/docs/[slug]", {
                  token: data.token,
                  slug: p.slug,
                })}
              >
                {p.title}
                <ChevronRightIcon
                  class="text-muted-foreground size-5 shrink-0 print:hidden"
                  aria-hidden="true"
                />
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
          <article
            class="bg-card break-inside-avoid rounded-xl border p-4 print:rounded-lg print:p-3"
          >
            <h3 class="font-semibold">{device.name}</h3>
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
                <GuestHtml html={hint.html} {locale} class="text-sm" />
                {#if hint.files.length > 0}
                  <ul class="mt-2 flex flex-wrap gap-x-4 text-sm">
                    {#each hint.files as file (file.id)}
                      <li>
                        <a
                          class="text-brand inline-flex min-h-11 items-center font-medium underline underline-offset-4"
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
      false,
    )}

    {#if empty}
      <p class="text-muted-foreground">{m.guest_empty({}, { locale })}</p>
    {/if}
  </GuestShell>
{/if}
