<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import HouseIcon from "@lucide/svelte/icons/house";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import SmartphoneIcon from "@lucide/svelte/icons/smartphone";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { m } from "$lib/paraglide/messages";

  let { children } = $props();

  const tabs = [
    {
      href: "/settings/account",
      label: () => m.settings_tab_account(),
      icon: UserRoundIcon,
    },
    {
      href: "/settings/household",
      label: () => m.settings_tab_household(),
      icon: HouseIcon,
    },
    {
      href: "/settings/tokens",
      label: () => m.settings_tab_tokens(),
      icon: KeyRoundIcon,
    },
    {
      href: "/settings/devices",
      label: () => m.settings_tab_devices(),
      icon: SmartphoneIcon,
    },
  ] as const;

  const active = $derived(
    tabs.find((tab) => page.url.pathname.startsWith(tab.href))?.href,
  );
</script>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.settings_title()}
    description={m.settings_description()}
  />
  <Tabs.Root value={active} class="gap-6">
    <Tabs.List
      aria-label={m.settings_tabs_label()}
      class="h-auto w-full justify-start overflow-x-auto sm:w-fit"
    >
      {#each tabs as tab (tab.href)}
        <Tabs.Trigger value={tab.href} class="flex-none px-2.5 py-1.5">
          {#snippet child({ props })}
            <a href={resolve(tab.href)} {...props}>
              <tab.icon />
              {tab.label()}
            </a>
          {/snippet}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    {@render children()}
  </Tabs.Root>
</div>
