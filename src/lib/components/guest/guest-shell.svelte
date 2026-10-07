<script lang="ts">
  import type { Snippet } from "svelte";
  import type { UserLocale } from "$lib/api/enums";
  import { m } from "$lib/paraglide/messages";

  let {
    title,
    locale,
    secrets = false,
    children,
  }: {
    title: string;
    locale: UserLocale;
    secrets?: boolean;
    children: Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="color-scheme" content="light" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <meta name="referrer" content="same-origin" />
</svelte:head>

<main
  lang={locale}
  class="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-8 print:max-w-none print:px-0 print:py-0"
>
  {#if secrets}
    <p
      class="rounded-md border-2 border-red-600 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-400"
    >
      {m.guest_confidential({}, { locale })}
    </p>
  {/if}
  {@render children()}
</main>
