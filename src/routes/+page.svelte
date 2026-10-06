<script lang="ts">
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale, locales, setLocale } from "$lib/paraglide/runtime";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";

  async function logout() {
    try {
      await api.call(endpoints.authLogout);
      window.location.assign("/login");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }
</script>

<svelte:head>
  <title>{m.app_name()}</title>
</svelte:head>

<main
  class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 text-center"
>
  <h1 class="text-4xl font-semibold tracking-tight">{m.app_name()}</h1>
  <p class="text-muted-foreground">{m.landing_tagline()}</p>
  <Badge variant="secondary">{m.landing_status()}</Badge>
  <div
    class="flex items-center gap-2"
    role="group"
    aria-label={m.language_label()}
  >
    {#each locales as locale (locale)}
      <Button
        size="sm"
        variant={locale === getLocale() ? "default" : "outline"}
        onclick={() => setLocale(locale)}
      >
        {locale.toUpperCase()}
      </Button>
    {/each}
  </div>
  <Button variant="ghost" size="sm" onclick={logout}>{m.auth_logout()}</Button>
</main>
