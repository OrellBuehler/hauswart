<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import type { User } from "$lib/api/schemas/auth";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import LocaleSwitch from "./locale-switch.svelte";
  import ThemeSwitch from "./theme-switch.svelte";

  let { user }: { user: User } = $props();

  const name = $derived(user.displayName || user.username);
  const initial = $derived(name.charAt(0).toUpperCase());

  let loggingOut = $state(false);

  async function logout() {
    if (loggingOut) return;
    loggingOut = true;
    try {
      await api.call(endpoints.authLogout);
      await goto(resolve("/login"), { invalidateAll: true });
    } catch (err) {
      toast.error(apiErrorMessage(err, { internal: m.auth_logout_failed() }));
      loggingOut = false;
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="hover:bg-accent focus-visible:ring-ring/50 data-[state=open]:bg-accent flex h-9 items-center gap-2 rounded-full ps-1 pe-1 text-sm outline-hidden transition-colors focus-visible:ring-[3px] md:rounded-md md:pe-2"
    aria-label={m.user_menu_open()}
  >
    <span
      class="bg-brand text-brand-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      aria-hidden="true">{initial}</span
    >
    <span class="hidden max-w-32 truncate font-medium md:inline">{name}</span>
    <ChevronDownIcon
      class="text-muted-foreground hidden size-4 md:inline"
      aria-hidden="true"
    />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-56">
    <DropdownMenu.Label class="flex flex-col gap-0.5 font-normal">
      <span class="truncate text-sm font-medium">{name}</span>
      <span class="text-muted-foreground truncate text-xs"
        >@{user.username}</span
      >
    </DropdownMenu.Label>
    <DropdownMenu.Separator />
    <DropdownMenu.Item>
      {#snippet child({ props })}
        <a href={resolve("/settings/account")} {...props}>
          <SettingsIcon />
          {m.nav_settings()}
        </a>
      {/snippet}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <LocaleSwitch />
    <DropdownMenu.Separator />
    <ThemeSwitch />
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      closeOnSelect={false}
      disabled={loggingOut}
      onSelect={logout}
    >
      <LogOutIcon />
      {m.auth_logout()}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
