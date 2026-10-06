<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { USER_LOCALES, type UserLocale } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import AuthCard from "$lib/components/app/auth-card.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";

  const localeNames: Record<UserLocale, () => string> = {
    de: () => m.locale_name_de(),
    en: () => m.locale_name_en(),
  };

  let username = $state("");
  let displayName = $state("");
  let password = $state("");
  let confirm = $state("");
  let locale = $state<UserLocale>(getLocale() as UserLocale);
  let pending = $state(false);
  let error = $state<string | undefined>();

  const mismatch = $derived(confirm.length > 0 && confirm !== password);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (password !== confirm) return;
    pending = true;
    error = undefined;
    try {
      await api.call(endpoints.setup, {
        body: { username, displayName, password, locale },
      });
      window.location.assign("/");
    } catch (err) {
      error = apiErrorMessage(err);
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.auth_setup_title()}</title>
</svelte:head>

<AuthCard>
  <Card.Root class="w-full">
    <Card.Header>
      <Card.Title class="text-xl">{m.auth_setup_title()}</Card.Title>
      <Card.Description>{m.auth_setup_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-4" onsubmit={submit}>
        <FormAlert message={error} />
        <div class="flex flex-col gap-2">
          <Label for="username">{m.auth_username()}</Label>
          <Input
            id="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
            minlength={3}
            maxlength={32}
            bind:value={username}
          />
          <p class="text-muted-foreground text-xs">{m.auth_username_hint()}</p>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="displayName">{m.auth_display_name()}</Label>
          <Input
            id="displayName"
            name="displayName"
            autocomplete="name"
            required
            maxlength={64}
            bind:value={displayName}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="password">{m.auth_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="new-password"
            required
            minlength={10}
            maxlength={256}
            bind:value={password}
          />
          <p class="text-muted-foreground text-xs">{m.auth_password_hint()}</p>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="confirm">{m.auth_password_confirm()}</Label>
          <Input
            id="confirm"
            type="password"
            autocomplete="new-password"
            required
            aria-invalid={mismatch}
            bind:value={confirm}
          />
          {#if mismatch}
            <p class="text-destructive text-xs">
              {m.auth_passwords_mismatch()}
            </p>
          {/if}
        </div>
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium">{m.auth_language()}</legend>
          <div class="flex gap-2">
            {#each USER_LOCALES as option (option)}
              <Button
                type="button"
                size="sm"
                variant={locale === option ? "default" : "outline"}
                aria-pressed={locale === option}
                onclick={() => (locale = option)}
              >
                {localeNames[option]()}
              </Button>
            {/each}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending || mismatch} class="w-full">
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />{m.auth_setup_pending()}
          {:else}
            {m.auth_setup_submit()}
          {/if}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</AuthCard>
