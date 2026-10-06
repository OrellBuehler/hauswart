import type { Component } from "svelte";
import BellRingIcon from "@lucide/svelte/icons/bell-ring";
import BoxesIcon from "@lucide/svelte/icons/boxes";
import BookOpenIcon from "@lucide/svelte/icons/book-open";
import ContactIcon from "@lucide/svelte/icons/contact";
import CoinsIcon from "@lucide/svelte/icons/coins";
import DoorOpenIcon from "@lucide/svelte/icons/door-open";
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import PuzzleIcon from "@lucide/svelte/icons/puzzle";
import SettingsIcon from "@lucide/svelte/icons/settings";
import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
import SproutIcon from "@lucide/svelte/icons/sprout";
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
  | "/defects"
  | "/parts"
  | "/contacts"
  | "/costs"
  | "/warranties"
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
        icon: BookOpenIcon,
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
        comingSoon: () => m.coming_soon_costs(),
        icon: CoinsIcon,
      },
      {
        href: "/warranties",
        label: () => m.nav_warranties(),
        icon: ShieldCheckIcon,
      },
    ],
  },
];

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
