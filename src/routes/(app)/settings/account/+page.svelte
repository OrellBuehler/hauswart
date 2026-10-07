<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { DISPLAY_NAME_MAX } from "$lib/api/schemas/auth";
  import { USER_LOCALES, type UserLocale } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { applyLocale } from "$lib/locale";
  import type { PageProps } from "./$types";
  import PasswordCard from "./password-card.svelte";

  let { data }: PageProps = $props();

  const localeNames: Record<UserLocale, () => string> = {
    de: () => m.locale_name_de(),
    en: () => m.locale_name_en(),
  };

  // svelte-ignore state_referenced_locally
  let displayName = $state(data.user.displayName ?? "");
  // svelte-ignore state_referenced_locally
  let locale = $state<UserLocale>(data.user.locale);
  let pending = $state(false);
  let error = $state<string | undefined>();

  const nameChanged = $derived(
    displayName.trim() !== (data.user.displayName ?? ""),
  );
  const localeChanged = $derived(locale !== data.user.locale);
  const dirty = $derived(nameChanged || localeChanged);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!dirty || pending) return;
    pending = true;
    error = undefined;
    try {
      const { user } = await api.call(endpoints.authUpdateMe, {
        body: {
          ...(nameChanged ? { displayName } : {}),
          ...(localeChanged ? { locale } : {}),
        },
      });
      displayName = user.displayName ?? "";
      if (localeChanged) {
        await applyLocale(user.locale);
        return;
      }
      await invalidateAll();
      toast.success(m.account_saved());
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.account_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <Card.Root class="max-w-xl">
    <Card.Header>
      <Card.Title>{m.account_title()}</Card.Title>
      <Card.Description>{m.account_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-5" onsubmit={submit}>
        <FormAlert message={error} />
        <dl
          class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm"
        >
          <dt class="text-muted-foreground">{m.account_username()}</dt>
          <dd class="truncate font-medium">{data.user.username}</dd>
          <dt class="text-muted-foreground">{m.account_role()}</dt>
          <dd>
            <Badge variant="secondary">
              {data.user.role === "admin" ? m.role_admin() : m.role_member()}
            </Badge>
          </dd>
        </dl>
        <div class="flex flex-col gap-2">
          <Label for="displayName">{m.auth_display_name()}</Label>
          <Input
            id="displayName"
            name="displayName"
            autocomplete="name"
            required
            maxlength={DISPLAY_NAME_MAX}
            bind:value={displayName}
          />
        </div>
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-sm font-medium">{m.auth_language()}</legend>
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
        <div>
          <Button type="submit" disabled={!dirty || pending}>
            {#if pending}
              <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
            {:else}
              {m.common_save()}
            {/if}
          </Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
  <PasswordCard username={data.user.username} />
</div>
