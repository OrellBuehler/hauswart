import type { Component } from "svelte";
import BellRingIcon from "@lucide/svelte/icons/bell-ring";
import BoxesIcon from "@lucide/svelte/icons/boxes";
import BookOpenIcon from "@lucide/svelte/icons/book-open";
import ContactIcon from "@lucide/svelte/icons/contact";
import CoinsIcon from "@lucide/svelte/icons/coins";
import DoorOpenIcon from "@lucide/svelte/icons/door-open";
import FileStackIcon from "@lucide/svelte/icons/file-stack";
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import PuzzleIcon from "@lucide/svelte/icons/puzzle";
import SettingsIcon from "@lucide/svelte/icons/settings";
import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
import SproutIcon from "@lucide/svelte/icons/sprout";
import UmbrellaIcon from "@lucide/svelte/icons/umbrella";
import UsersIcon from "@lucide/svelte/icons/users";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import { m } from "$lib/paraglide/messages";

export type NavHref =
  | "/"
  | "/tasks"
  | "/inventory"
  | "/rooms"
  | "/plants"
  | "/docs"
  | "/documents"
  | "/defects"
  | "/parts"
  | "/contacts"
  | "/costs"
  | "/warranties"
  | "/insurance"
  | "/emergency"
  | "/settings/account"
  | "/admin/users";

export type NavItem = {
  href: NavHref;
  /** Path prefix that marks the item active; defaults to `href`. */
  match?: string;
  /** More path prefixes that belong to the same section (e.g. detail pages). */
  alsoMatch?: string[];
  label: () => string;
  /** A shorter name for the cramped bottom bar on phones; defaults to `label`. */
  shortLabel?: () => string;
  /** The entry is only offered to people who have this feature (an optional integration). */
  requires?: "documentSystem";
  /** One sentence for the placeholder page of a section that is not built yet. */
  comingSoon?: () => string;
  icon: Component;
};

export type NavGroup = { label: () => string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    label: () => m.nav_group_overview(),
    items: [
      { href: "/", label: () => m.nav_dashboard(), icon: LayoutDashboardIcon },
      {
        href: "/tasks",
        label: () => m.nav_tasks(),
        comingSoon: () => m.coming_soon_tasks(),
        icon: ListChecksIcon,
      },
    ],
  },
  {
    label: () => m.nav_group_home(),
    items: [
      {
        href: "/inventory",
        alsoMatch: ["/assets", "/d"],
        label: () => m.nav_inventory(),
        comingSoon: () => m.coming_soon_inventory(),
        icon: BoxesIcon,
      },
      {
        href: "/rooms",
        label: () => m.nav_rooms(),
        comingSoon: () => m.coming_soon_rooms(),
        icon: DoorOpenIcon,
      },
      {
        href: "/plants",
        label: () => m.nav_plants(),
        comingSoon: () => m.coming_soon_plants(),
        icon: SproutIcon,
      },
      {
        href: "/docs",
        label: () => m.nav_docs(),
        shortLabel: () => m.nav_docs_short(),
        icon: BookOpenIcon,
      },
      {
        href: "/documents",
        label: () => m.nav_documents(),
        requires: "documentSystem",
        icon: FileStackIcon,
      },
    ],
  },
  {
    label: () => m.nav_group_upkeep(),
    items: [
      {
        href: "/defects",
        label: () => m.nav_defects(),
        icon: WrenchIcon,
      },
      {
        href: "/parts",
        label: () => m.nav_parts(),
        comingSoon: () => m.coming_soon_parts(),
        icon: PuzzleIcon,
      },
      {
        href: "/contacts",
        label: () => m.nav_contacts(),
        comingSoon: () => m.coming_soon_contacts(),
        icon: ContactIcon,
      },
      {
        href: "/emergency",
        label: () => m.nav_emergency(),
        icon: BellRingIcon,
      },
    ],
  },
  {
    label: () => m.nav_group_finance(),
    items: [
      {
        href: "/costs",
        label: () => m.nav_costs(),
        icon: CoinsIcon,
      },
      {
        href: "/warranties",
        label: () => m.nav_warranties(),
        icon: ShieldCheckIcon,
      },
      {
        href: "/insurance",
        label: () => m.nav_insurance(),
        icon: UmbrellaIcon,
      },
    ],
  },
];

export type NavFeatures = { documentSystem: boolean };

/** The groups with the entries the person can use: those of an optional integration only when they have it. */
export function visibleNavGroups(
  groups: readonly NavGroup[],
  features: NavFeatures,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.requires === undefined || features[item.requires],
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export const settingsNavItem: NavItem = {
  href: "/settings/account",
  match: "/settings",
  label: () => m.nav_settings(),
  icon: SettingsIcon,
};

export const adminNavItems: NavItem[] = [
  {
    href: "/admin/users",
    label: () => m.nav_admin_users(),
    icon: UsersIcon,
  },
];

const allItems = [
  ...navGroups.flatMap((g) => g.items),
  settingsNavItem,
  ...adminNavItems,
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  return [item.match ?? item.href, ...(item.alsoMatch ?? [])].some((base) =>
    base === "/"
      ? pathname === "/"
      : pathname === base || pathname.startsWith(`${base}/`),
  );
}

export function findNavItem(pathname: string): NavItem | undefined {
  return allItems.find((item) => isNavActive(item, pathname));
}

export function navItemFor(href: NavHref): NavItem {
  const item = allItems.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav entry ${href}`);
  return item;
}

/** The tabs of the bottom bar on phones. Everything else sits behind its "More" tab (the sidebar sheet). */
export const mobileTabs: NavItem[] = [
  navItemFor("/"),
  navItemFor("/tasks"),
  navItemFor("/inventory"),
  navItemFor("/docs"),
];

/** The "More" tab stands for every page that has no tab of its own. */
export function isMoreActive(pathname: string): boolean {
  return !mobileTabs.some((item) => isNavActive(item, pathname));
}

/**
 * Whether the bottom bar is shown on this page. Forms (`/new`, `/edit`) keep their save bar at the
 * bottom of the screen.
 */
export function showsBottomNav(pathname: string): boolean {
  return !/\/(?:new|edit)\/?$/.test(pathname);
}

/** Pages reached from the header, not from the navigation. */
const extraTitles: { match: string; label: () => string }[] = [
  { match: "/notifications", label: () => m.notifications_title() },
  { match: "/search", label: () => m.search_page_title() },
];

/** The title the header shows for a page: its navigation entry, else the page's own name. */
export function headerTitleFor(pathname: string): string {
  const item = findNavItem(pathname);
  if (item) return item.label();
  const extra = extraTitles.find(
    ({ match }) => pathname === match || pathname.startsWith(`${match}/`),
  );
  return extra ? extra.label() : m.app_name();
}
