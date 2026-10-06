<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
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
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let username = $state("");
  let password = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    pending = true;
    error = undefined;
    try {
      await api.call(endpoints.authLogin, { body: { username, password } });
      // Full navigation: the server set the account's language cookie.
      window.location.assign(data.redirectTo);
    } catch (err) {
      error = apiErrorMessage(err);
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.auth_login_title()} · {m.app_name()}</title>
</svelte:head>

<AuthCard>
  <Card.Root class="w-full">
    <Card.Header>
      <Card.Title class="text-xl">{m.auth_login_title()}</Card.Title>
      <Card.Description>{m.auth_login_description()}</Card.Description>
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
            bind:value={username}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="password">{m.auth_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            bind:value={password}
          />
        </div>
        <Button type="submit" disabled={pending} class="w-full">
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />{m.auth_login_pending()}
          {:else}
            {m.auth_login_submit()}
          {/if}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</AuthCard>
