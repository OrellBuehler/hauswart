<script lang="ts">
  import { resolve } from "$app/paths";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import GuestHtml from "$lib/components/guest/guest-html.svelte";
  import GuestShell from "$lib/components/guest/guest-shell.svelte";
  import PinForm from "$lib/components/guest/pin-form.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const locale = $derived(data.locale);
</script>

{#if data.locked}
  <GuestShell title={m.guest_pin_title({}, { locale })} {locale}>
    <PinForm {locale} failure={form} />
  </GuestShell>
{:else}
  <GuestShell title={data.page.title} {locale} secrets={data.secrets}>
    <nav class="print:hidden">
      <a
        class="text-brand inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        href={resolve("/g/[token]", { token: data.token })}
      >
        <ChevronLeftIcon class="size-4" aria-hidden="true" />{m.guest_back(
          {},
          { locale },
        )}
      </a>
    </nav>
    <h1 class="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
      {data.page.title}
    </h1>
    <GuestHtml html={data.page.html} {locale} />
  </GuestShell>
{/if}
