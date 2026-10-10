<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import AppNav from "$lib/components/app/app-nav.svelte";
  import { backTarget } from "$lib/components/app/back-target";
  import BottomNav from "$lib/components/app/bottom-nav.svelte";
  import Logo from "$lib/components/app/logo.svelte";
  import NavProgress from "$lib/components/app/nav-progress.svelte";
  import SearchTrigger from "$lib/components/search/search-trigger.svelte";
  import NotificationBell from "$lib/components/notifications/notification-bell.svelte";
  import {
    adminNavItems,
    headerTitleFor,
    navGroups,
    settingsNavItem,
    showsBottomNav,
    visibleNavGroups,
  } from "$lib/components/app/nav";
  import UserMenu from "$lib/components/app/user-menu.svelte";
  import { DocumentSystem } from "$lib/documents/system.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();

  const documents = new DocumentSystem();
  $effect(() => documents.start());

  const groups = $derived(
    visibleNavGroups(navGroups, {
      documentSystem: Boolean(documents.provider),
    }),
  );
  const pathname = $derived(page.url.pathname);
  const headerTitle = $derived(headerTitleFor(pathname));
  const back = $derived(backTarget(pathname));
  const bottomNav = $derived(showsBottomNav(pathname));
  const bottomItems = $derived(
    data.user.role === "admin"
      ? [settingsNavItem, ...adminNavItems]
      : [settingsNavItem],
  );

  /** An installed app that sat in the background shows stale lists: load them again on return. */
  const STALE_AFTER_MS = 60_000;
  let hiddenAt: number | null = null;

  function onvisibilitychange() {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const wasAwayFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (wasAwayFor <= STALE_AFTER_MS || !navigator.onLine) return;
    invalidateAll().catch((err) =>
      console.warn("refresh after resume failed", err),
    );
  }
</script>

<svelte:document {onvisibilitychange} />

<NavProgress />

<Sidebar.Provider>
  <Sidebar.Root collapsible="icon">
    <Sidebar.Header>
      <a
        href={resolve("/")}
        class="ring-sidebar-ring flex h-11 items-center rounded-md outline-hidden transition-opacity hover:opacity-80 focus-visible:ring-2"
        aria-label={m.nav_home_aria()}
      >
        <Logo />
      </a>
    </Sidebar.Header>
    <Sidebar.Content>
      {#each groups as group (group.label())}
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
      class="bg-background/70 sticky top-0 z-10 flex h-12 items-center gap-1 border-b px-3 backdrop-blur-md backdrop-saturate-150 md:gap-2 md:px-4 print:hidden"
    >
      {#if back}
        <Button
          href={resolve(back as "/")}
          variant="ghost"
          size="icon-lg"
          class="-ms-2 md:hidden"
          aria-label={m.nav_back()}
        >
          <ArrowLeftIcon />
        </Button>
      {/if}
      <Sidebar.Trigger class="-ms-1 hidden md:inline-flex" />
      <Separator
        orientation="vertical"
        class="me-1 hidden data-[orientation=vertical]:h-4 md:block"
      />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {headerTitle}
      </span>
      <div class="flex shrink-0 items-center gap-1">
        <SearchTrigger />
        <NotificationBell />
        <UserMenu user={data.user} />
      </div>
    </header>
    <div
      class="mx-auto w-full max-w-5xl min-w-0 flex-1 p-4 pb-[calc(var(--bottom-nav)+env(safe-area-inset-bottom)+6rem)] md:p-8 md:pb-8 print:max-w-none print:p-0 print:pb-0"
    >
      {#key pathname}
        <div
          class="animate-in fade-in slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none"
        >
          {@render children()}
        </div>
      {/key}
    </div>
  </Sidebar.Inset>
  {#if bottomNav}
    <BottomNav {pathname} />
  {/if}
</Sidebar.Provider>
