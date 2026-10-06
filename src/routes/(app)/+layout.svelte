<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import AppNav from "$lib/components/app/app-nav.svelte";
  import Logo from "$lib/components/app/logo.svelte";
  import NotificationBell from "$lib/components/notifications/notification-bell.svelte";
  import {
    adminNavItems,
    findNavItem,
    navGroups,
    settingsNavItem,
  } from "$lib/components/app/nav";
  import UserMenu from "$lib/components/app/user-menu.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();

  const pathname = $derived(page.url.pathname);
  const section = $derived(findNavItem(pathname));
  const bottomItems = $derived(
    data.user.role === "admin"
      ? [settingsNavItem, ...adminNavItems]
      : [settingsNavItem],
  );
</script>

<Sidebar.Provider>
  <Sidebar.Root collapsible="icon">
    <Sidebar.Header>
      <a
        href={resolve("/")}
        class="ring-sidebar-ring flex h-11 items-center rounded-md px-1 outline-hidden transition-opacity hover:opacity-80 focus-visible:ring-2"
        aria-label={m.nav_home_aria()}
      >
        <Logo />
      </a>
    </Sidebar.Header>
    <Sidebar.Content>
      {#each navGroups as group (group.label())}
        <Sidebar.Group>
          <Sidebar.GroupLabel>{group.label()}</Sidebar.GroupLabel>
          <Sidebar.GroupContent>
            <AppNav items={group.items} {pathname} />
          </Sidebar.GroupContent>
        </Sidebar.Group>
      {/each}
    </Sidebar.Content>
    <Sidebar.Footer>
      <Sidebar.Separator class="mx-0" />
      <AppNav items={bottomItems} {pathname} />
    </Sidebar.Footer>
    <Sidebar.Rail />
  </Sidebar.Root>

  <Sidebar.Inset class="min-w-0">
    <header
      class="bg-background/70 sticky top-0 z-10 flex h-12 items-center gap-2 border-b px-4 backdrop-blur-md backdrop-saturate-150 print:hidden"
    >
      <Sidebar.Trigger class="-ms-1" />
      <Separator
        orientation="vertical"
        class="me-1 data-[orientation=vertical]:h-4"
      />
      <span class="truncate text-sm font-medium">
        {section ? section.label() : m.app_name()}
      </span>
      <div class="ms-auto flex items-center gap-1">
        <NotificationBell />
        <UserMenu user={data.user} />
      </div>
    </header>
    <div
      class="mx-auto w-full max-w-5xl min-w-0 flex-1 p-4 md:p-8 print:max-w-none print:p-0"
    >
      {#key pathname}
        <div
          class="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out motion-reduce:animate-none"
        >
          {@render children()}
        </div>
      {/key}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
