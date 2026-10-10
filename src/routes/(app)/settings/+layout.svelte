<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import BellIcon from "@lucide/svelte/icons/bell";
  import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
  import HouseIcon from "@lucide/svelte/icons/house";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import LinkIcon from "@lucide/svelte/icons/link-2";
  import PlugIcon from "@lucide/svelte/icons/plug";
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
      href: "/settings/notifications",
      label: () => m.settings_tab_notifications(),
      icon: BellIcon,
    },
    {
      href: "/settings/household",
      label: () => m.settings_tab_household(),
      icon: HouseIcon,
    },
    {
      href: "/settings/integrations",
      label: () => m.settings_tab_integrations(),
      icon: PlugIcon,
    },
    {
      href: "/settings/calendar",
      label: () => m.settings_tab_calendar(),
      icon: CalendarDaysIcon,
    },
    {
      href: "/settings/guest-links",
      label: () => m.settings_tab_guest_links(),
      icon: LinkIcon,
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

  let list = $state<HTMLElement | null>(null);
  let fade = $state<"none" | "start" | "end" | "both">("none");

  function measure() {
    if (!list) return;
    const start = list.scrollLeft > 1;
    const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    fade = start ? (end ? "both" : "start") : end ? "end" : "none";
  }

  $effect(() => {
    if (!list) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!list || !active) return;
    const current = list.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) return;
    const box = list.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    list.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
    measure();
  });
</script>

<div class="flex flex-col gap-6">
  <div>
    <PageHeader title={m.settings_title()} />
    <p class="text-muted-foreground mt-1 hidden text-sm text-pretty sm:block">
      {m.settings_description()}
    </p>
  </div>
  <Tabs.Root value={active} class="gap-6">
    <Tabs.List
      bind:ref={list}
      aria-label={m.settings_tabs_label()}
      data-fade={fade}
      onscroll={measure}
      class="h-auto w-full [scrollbar-width:none] justify-start overflow-x-auto data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%-1.5rem),transparent)] data-[fade=end]:[mask-image:linear-gradient(to_left,transparent,#000_1.5rem)] data-[fade=start]:[mask-image:linear-gradient(to_right,transparent,#000_1.5rem)] sm:w-fit sm:max-w-full [&::-webkit-scrollbar]:hidden"
    >
      {#each tabs as tab (tab.href)}
        <Tabs.Trigger value={tab.href} class="flex-none px-2.5 py-1.5">
          {#snippet child({ props })}
            <a
              href={resolve(tab.href)}
              aria-current={active === tab.href ? "page" : undefined}
              {...props}
            >
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
