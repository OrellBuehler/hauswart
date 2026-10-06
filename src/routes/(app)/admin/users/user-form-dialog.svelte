<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import {
    USER_LOCALES,
    USER_ROLES,
    type UserLocale,
    type UserRole,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import {
    DISPLAY_NAME_MAX,
    PASSWORD_MAX,
    PASSWORD_MIN,
  } from "$lib/api/schemas/auth";
  import type { AdminUser } from "$lib/api/schemas/users";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";

  let {
    open = $bindable(false),
    user,
    onsaved,
  }: {
    open?: boolean;
    /** The user to edit; undefined creates a new one. */
    user: AdminUser | undefined;
    onsaved: () => void | Promise<void>;
  } = $props();

  const roleNames: Record<UserRole, () => string> = {
    admin: () => m.role_admin(),
    member: () => m.role_member(),
  };
  const localeNames: Record<UserLocale, () => string> = {
    de: () => m.locale_name_de(),
    en: () => m.locale_name_en(),
  };

  let username = $state("");
  let displayName = $state("");
  let role = $state<UserRole>("member");
  let password = $state("");
  let locale = $state<UserLocale>("de");
  let share = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  const editing = $derived(user !== undefined);

  $effect(() => {
    if (!open) return;
    username = "";
    displayName = user?.displayName ?? "";
    role = user?.role ?? "member";
    password = "";
    locale = getLocale();
    share = user ? String(user.ownershipBps / 100) : "";
    error = undefined;
  });

  /** The share input as basis points; null when empty, NaN when invalid. */
  function shareBps(): number | null {
    const raw = share.trim().replace(",", ".");
    if (raw === "") return null;
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return NaN;
    return Math.round(percent * 100);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    const bps = shareBps();
    if (Number.isNaN(bps)) {
      error = m.admin_users_share_invalid();
      return;
    }
    pending = true;
    error = undefined;
    try {
      let name: string;
      if (user) {
        const body = {
          ...(displayName.trim() !== (user.displayName ?? "")
            ? { displayName }
            : {}),
          ...(role !== user.role ? { role } : {}),
          ...(bps !== null && bps !== user.ownershipBps
            ? { ownershipBps: bps }
            : {}),
        };
        if (Object.keys(body).length > 0) {
          await api.call(endpoints.usersUpdate, {
            params: { id: user.id },
            body,
          });
        }
        name = displayName.trim() || user.username;
        toast.success(m.admin_users_saved_toast({ name }));
      } else {
        const result = await api.call(endpoints.usersCreate, {
          body: {
            username,
            displayName,
            password,
            role,
            locale,
            ...(bps !== null ? { ownershipBps: bps } : {}),
          },
        });
        name = result.user.displayName || result.user.username;
        toast.success(m.admin_users_created_toast({ name }));
      }
      open = false;
      await onsaved();
    } catch (err) {
      error = apiErrorMessage(
        err,
        editing
          ? { conflict: m.admin_users_error_last_admin() }
          : { conflict: m.admin_users_error_username_taken() },
      );
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>
        {editing ? m.admin_users_edit_title() : m.admin_users_create_title()}
      </Dialog.Title>
      <Dialog.Description>
        {editing
          ? m.admin_users_edit_description({
              name: user?.displayName || user?.username || "",
            })
          : m.admin_users_create_description()}
      </Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      {#if !editing}
        <div class="flex flex-col gap-2">
          <Label for="user-username">{m.auth_username()}</Label>
          <Input
            id="user-username"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            required
            minlength={3}
            maxlength={32}
            bind:value={username}
          />
          <p class="text-muted-foreground text-xs">{m.auth_username_hint()}</p>
        </div>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="user-display-name">{m.auth_display_name()}</Label>
        <Input
          id="user-display-name"
          autocomplete="off"
          required
          maxlength={DISPLAY_NAME_MAX}
          bind:value={displayName}
        />
      </div>
      <div class="grid gap-5 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="user-role">{m.admin_users_role()}</Label>
          <Select.Root type="single" bind:value={role}>
            <Select.Trigger id="user-role" class="w-full">
              {roleNames[role]()}
            </Select.Trigger>
            <Select.Content>
              {#each USER_ROLES as option (option)}
                <Select.Item value={option} label={roleNames[option]()} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        {#if !editing}
          <div class="flex flex-col gap-2">
            <Label for="user-locale">{m.admin_users_locale()}</Label>
            <Select.Root type="single" bind:value={locale}>
              <Select.Trigger id="user-locale" class="w-full">
                {localeNames[locale]()}
              </Select.Trigger>
              <Select.Content>
                {#each USER_LOCALES as option (option)}
                  <Select.Item value={option} label={localeNames[option]()} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      </div>
      {#if !editing}
        <div class="flex flex-col gap-2">
          <Label for="user-password">{m.admin_users_initial_password()}</Label>
          <Input
            id="user-password"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            required
            minlength={PASSWORD_MIN}
            maxlength={PASSWORD_MAX}
            bind:value={password}
          />
          <p class="text-muted-foreground text-xs">{m.auth_password_hint()}</p>
        </div>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="user-share">{m.admin_users_share_label()}</Label>
        <Input
          id="user-share"
          inputmode="decimal"
          autocomplete="off"
          placeholder="50"
          bind:value={share}
        />
        <p class="text-muted-foreground text-xs">
          {m.admin_users_share_hint()}
        </p>
      </div>
      <FormAlert message={error} />
      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button type="submit" disabled={pending}>
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
          {:else if editing}
            {m.common_save()}
          {:else}
            {m.common_create()}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
