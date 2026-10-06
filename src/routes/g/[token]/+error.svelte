<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages";

  const kind = $derived(
    page.status === 429
      ? "rate"
      : page.error?.message === "page"
        ? "page"
        : "gone",
  );
  const texts = $derived(
    (["de", "en"] as const).map((locale) =>
      kind === "rate"
        ? {
            locale,
            title: m.guest_limited_title({}, { locale }),
            body: m.guest_limited_body({}, { locale }),
          }
        : kind === "page"
          ? {
              locale,
              title: m.guest_page_missing_title({}, { locale }),
              body: m.guest_page_missing_body({}, { locale }),
            }
          : {
              locale,
              title: m.guest_gone_title({}, { locale }),
              body: m.guest_gone_body({}, { locale }),
            },
    ),
  );
</script>

<svelte:head>
  <title>{texts[0].title}</title>
  <meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

<main
  class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-8 px-4"
>
  {#each texts as text (text.locale)}
    <section lang={text.locale}>
      <h1 class="text-2xl font-semibold">{text.title}</h1>
      <p class="text-muted-foreground mt-1">{text.body}</p>
    </section>
  {/each}
</main>
